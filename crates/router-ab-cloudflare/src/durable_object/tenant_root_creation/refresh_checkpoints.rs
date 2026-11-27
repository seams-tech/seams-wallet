//! Refresh commitment, contribution and installation checkpoints, their calls and response validators.

use super::*;

pub(super) enum ValidatedTenantRootRefreshInstallationStateV1 {
    OneRole {
        role: TwoPartyDeriverRole,
        command_digest: TenantRootProtocolDigestV1,
        evidence: Box<VerifiedTenantRootSignedShareInstallationEvidenceWireV1>,
    },
    BothRoles {
        deriver_a_command_digest: TenantRootProtocolDigestV1,
        deriver_b_command_digest: TenantRootProtocolDigestV1,
        deriver_a: Box<VerifiedTenantRootSignedShareInstallationEvidenceWireV1>,
        deriver_b: Box<VerifiedTenantRootSignedShareInstallationEvidenceWireV1>,
        root_commitment: [u8; 32],
    },
}

pub(super) fn verify_refresh_commitment_wire(
    bytes: &[u8],
    context: &TenantRootCeremonyContextV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootRefreshCommitmentV1> {
    let signed = TenantRootSignedRefreshCommitmentV1::decode_canonical_bytes(bytes)
        .map_err(candidate_derivation_error)?;
    let role = signed.role();
    let verifying_key = role_keys.for_role_and_key_id(role, signed.signing_key_id())?;
    signed
        .verify_strict(context, role, context.signing_key_id(role), verifying_key)
        .map_err(candidate_authorization_error)
}

pub(super) fn verify_refresh_contribution_wire(
    bytes: &[u8],
    context: &TenantRootCeremonyContextV1,
    commitments: &VerifiedTenantRootRefreshCommitmentPairV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootSignedRefreshContributionV1> {
    let signed = TenantRootSignedRefreshContributionV1::decode_canonical_bytes(bytes)
        .map_err(candidate_derivation_error)?;
    let role = signed.envelope().source();
    let aad = match role {
        TwoPartyDeriverRole::DeriverA => {
            TenantRootRefreshContributionAadV1::deriver_a_to_b(commitments)
        }
        TwoPartyDeriverRole::DeriverB => {
            TenantRootRefreshContributionAadV1::deriver_b_to_a(commitments)
        }
    }
    .map_err(candidate_derivation_error)?;
    if aad.context() != context {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh contribution does not match its ceremony context",
        ));
    }
    let verifying_key = role_keys.for_role_and_key_id(role, context.signing_key_id(role))?;
    signed
        .verify_signature(&aad, verifying_key)
        .map_err(candidate_authorization_error)
}

pub(super) fn refresh_commitment_checkpoint_pair_digest(
    pair: &VerifiedTenantRootRefreshCommitmentPairV1,
) -> RouterAbProtocolResult<TenantRootProtocolDigestV1> {
    let mut hasher = Sha256::new();
    hasher.update(b"tenant_root_refresh_commitment_pair_v1");
    let deriver_a = pair.deriver_a().canonical_bytes();
    let deriver_b = pair.deriver_b().canonical_bytes();
    hasher.update((deriver_a.len() as u32).to_be_bytes());
    hasher.update(deriver_a);
    hasher.update((deriver_b.len() as u32).to_be_bytes());
    hasher.update(deriver_b);
    TenantRootProtocolDigestV1::from_bytes(hasher.finalize().into())
        .map_err(candidate_derivation_error)
}

pub(super) fn encode_refresh_commitment_checkpoint(
    checkpoint: &TenantRootRefreshCommitmentCheckpointV1,
) -> RouterAbProtocolResult<String> {
    let bytes = checkpoint
        .canonical_bytes()
        .map_err(candidate_derivation_error)?;
    Ok(encode_base64url_bytes_v1(&bytes))
}

pub(super) fn decode_refresh_commitment_checkpoint(
    encoded: &str,
) -> RouterAbProtocolResult<TenantRootRefreshCommitmentCheckpointV1> {
    let bytes = decode_canonical_base64url(
        "tenant-root refresh commitment checkpoint",
        encoded,
        TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_MAX_BYTES_V1,
        TENANT_ROOT_REFRESH_CHECKPOINT_MAX_BASE64URL_BYTES_V1,
    )?;
    TenantRootRefreshCommitmentCheckpointV1::decode_canonical_bytes(&bytes)
        .map_err(candidate_derivation_error)
}

pub(super) fn validate_refresh_commitment_checkpoint_scope(
    stored: &TenantRootRefreshCommitmentCheckpointScopeV1,
    expected: &CloudflareTenantRootRefreshCheckpointScopeV1,
) -> RouterAbProtocolResult<()> {
    let expected_identity = TenantRootIdentityDigestV1::from_bytes(decode_fixed_base64url_32(
        "tenant-root refresh checkpoint identity digest",
        &expected.identity_digest_b64u,
    )?);
    let expected_lineage = decode_lineage_b64u(
        "tenant-root refresh checkpoint custody lineage",
        &expected.custody_lineage_b64u,
    )?;
    let expected_authority =
        TenantRootControlPlaneAuthorityIdV1::from_bytes(decode_fixed_base64url_32(
            "tenant-root refresh checkpoint authority id",
            &expected.authority_id_b64u,
        )?);
    let expected_context = decode_protocol_digest_b64u(
        "tenant-root refresh checkpoint context digest",
        &expected.ceremony_context_digest_b64u,
    )?;
    let expected_receipt = decode_lifecycle_receipt_digest(
        "tenant-root refresh checkpoint activation receipt digest",
        &expected.active_activation_receipt_digest_b64u,
    )?;
    let expected_deriver_a = decode_share_commitment_b64u(
        "tenant-root refresh checkpoint Deriver A commitment",
        &expected.deriver_a_commitment_b64u,
    )?;
    let expected_deriver_b = decode_share_commitment_b64u(
        "tenant-root refresh checkpoint Deriver B commitment",
        &expected.deriver_b_commitment_b64u,
    )?;
    let expected_root = decode_fixed_base64url_32(
        "tenant-root refresh checkpoint active root commitment",
        &expected.active_root_commitment_b64u,
    )?;
    if stored.identity_digest() != expected_identity
        || stored.custody_lineage() != expected_lineage
        || stored.authority_id() != expected_authority
        || stored.ceremony_context_digest() != expected_context
        || stored.current_epoch().get().get() != expected.current_epoch
        || stored.next_epoch().get().get() != expected.next_epoch
        || stored.expected_control_plane_revision() != expected.expected_control_plane_revision
        || stored.active_root_commitment() != &expected_root
        || stored.active_activation_receipt_digest() != expected_receipt
        || stored.deriver_a_share_commitment() != &expected_deriver_a
        || stored.deriver_b_share_commitment() != &expected_deriver_b
    {
        return Err(malformed_input(
            "stored tenant-root refresh commitment checkpoint scope is invalid",
        ));
    }
    Ok(())
}

pub(super) fn require_complete_refresh_commitment_checkpoint(
    checkpoint: &TenantRootRefreshCommitmentCheckpointV1,
    context: &TenantRootCeremonyContextV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootRefreshCommitmentPairV1> {
    let deriver_a_bytes = checkpoint
        .state()
        .deriver_a_signed_commitment()
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root refresh installation requires both commitments",
            )
        })?;
    let deriver_b_bytes = checkpoint
        .state()
        .deriver_b_signed_commitment()
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MissingPairPreparation,
                "tenant-root refresh installation requires both commitments",
            )
        })?;
    let deriver_a = verify_refresh_commitment_wire(deriver_a_bytes, context, role_keys)?;
    let deriver_b = verify_refresh_commitment_wire(deriver_b_bytes, context, role_keys)?;
    VerifiedTenantRootRefreshCommitmentPairV1::new(deriver_a, deriver_b)
        .map_err(candidate_derivation_error)
}

pub(super) fn refresh_commitment_response_outcome(
    outcome: TenantRootRefreshCommitmentCheckpointOutcomeV1,
    candidate_bytes: &[u8],
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshCommitmentResponseOutcomeV1> {
    match outcome {
        TenantRootRefreshCommitmentCheckpointOutcomeV1::WaitingForPeer { role } => Ok(
            CloudflareTenantRootRefreshCommitmentResponseOutcomeV1::WaitingForPeer {
                role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(role),
                signed_commitment_b64u: encode_base64url_bytes_v1(candidate_bytes),
            },
        ),
        TenantRootRefreshCommitmentCheckpointOutcomeV1::BothRolesCommitted { pair } => Ok(
            CloudflareTenantRootRefreshCommitmentResponseOutcomeV1::BothRolesCommitted {
                deriver_a_signed_commitment_b64u: encode_base64url_bytes_v1(
                    pair.deriver_a().canonical_bytes(),
                ),
                deriver_b_signed_commitment_b64u: encode_base64url_bytes_v1(
                    pair.deriver_b().canonical_bytes(),
                ),
                pair_digest_b64u: encode_base64url_bytes_v1(
                    refresh_commitment_checkpoint_pair_digest(&pair)?.as_bytes(),
                ),
            },
        ),
    }
}

pub(super) fn refresh_commitment_evaluation_error(
    error: RouterAbDerivationError,
    has_existing_checkpoint: bool,
) -> RouterAbProtocolError {
    if error.code() == RouterAbDerivationErrorCode::ReplayMismatch {
        return refresh_replay_conflict(
            "tenant-root refresh commitment checkpoint conflicts with the accepted state",
        );
    }
    if has_existing_checkpoint {
        return stored_refresh_record_error(candidate_derivation_error(error));
    }
    candidate_derivation_error(error)
}

pub(super) fn validate_refresh_installation_evidence_candidate(
    encoded: &str,
    context: &TenantRootCeremonyContextV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootSignedShareInstallationEvidenceWireV1> {
    let bytes = decode_canonical_base64url(
        "tenant-root signed refresh installation evidence",
        encoded,
        TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
        TENANT_ROOT_CREATION_INSTALLATION_EVIDENCE_MAX_BASE64URL_BYTES_V1,
    )?;
    let verified = decode_and_verify_refresh_installation_evidence(&bytes, role_keys)?;
    if verified.evidence().transcript().context() != context {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh installation evidence does not match its ceremony context",
        ));
    }
    Ok(verified)
}

pub(super) fn decode_and_verify_refresh_installation_evidence(
    bytes: &[u8],
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootSignedShareInstallationEvidenceWireV1> {
    let signed = TenantRootSignedShareInstallationEvidenceV1::decode_canonical_bytes(bytes)
        .map_err(candidate_derivation_error)?;
    let role = signed.role();
    let verifying_key = role_keys.for_role_and_key_id(role, signed.signing_key_id())?;
    TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        bytes,
        verifying_key,
    )
    .map_err(candidate_authorization_error)
}

pub(super) fn validate_refresh_installation_checkpoint(
    record: CloudflareTenantRootRefreshInstallationCheckpointRecordV1,
    expected_scope: &CloudflareTenantRootRefreshCheckpointScopeV1,
    context: &TenantRootCeremonyContextV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    commitments: &VerifiedTenantRootRefreshCommitmentPairV1,
    current_commitments: &TenantRootEpochCommitmentsV1,
) -> RouterAbProtocolResult<ValidatedTenantRootRefreshInstallationStateV1> {
    if &record.scope != expected_scope {
        return Err(malformed_input(
            "stored tenant-root refresh installation checkpoint scope is invalid",
        ));
    }
    match record.state {
        CloudflareTenantRootRefreshInstallationCheckpointStateV1::OneRoleReady {
            role,
            command_digest_b64u,
            signed_evidence_b64u,
        } => {
            let command_digest = decode_protocol_digest_b64u(
                "stored tenant-root refresh installation command digest",
                &command_digest_b64u,
            )?;
            let evidence = validate_refresh_installation_evidence_candidate(
                &signed_evidence_b64u,
                context,
                role_keys,
            )?;
            if evidence.evidence().transcript().role() != role.to_protocol() {
                return Err(malformed_input(
                    "stored tenant-root refresh installation role does not match its wire",
                ));
            }
            Ok(ValidatedTenantRootRefreshInstallationStateV1::OneRole {
                role: role.to_protocol(),
                command_digest,
                evidence: Box::new(evidence),
            })
        }
        CloudflareTenantRootRefreshInstallationCheckpointStateV1::BothRolesReady {
            deriver_a_command_digest_b64u,
            deriver_b_command_digest_b64u,
            deriver_a_signed_evidence_b64u,
            deriver_b_signed_evidence_b64u,
            root_commitment_b64u,
        } => {
            let deriver_a_command_digest = decode_protocol_digest_b64u(
                "stored tenant-root refresh Deriver A installation command digest",
                &deriver_a_command_digest_b64u,
            )?;
            let deriver_b_command_digest = decode_protocol_digest_b64u(
                "stored tenant-root refresh Deriver B installation command digest",
                &deriver_b_command_digest_b64u,
            )?;
            let deriver_a = validate_refresh_installation_evidence_candidate(
                &deriver_a_signed_evidence_b64u,
                context,
                role_keys,
            )?;
            let deriver_b = validate_refresh_installation_evidence_candidate(
                &deriver_b_signed_evidence_b64u,
                context,
                role_keys,
            )?;
            if deriver_a.evidence().transcript().role() != TwoPartyDeriverRole::DeriverA
                || deriver_b.evidence().transcript().role() != TwoPartyDeriverRole::DeriverB
            {
                return Err(malformed_input(
                    "stored tenant-root refresh installation pair roles are invalid",
                ));
            }
            let next_commitments = verify_tenant_root_refresh_installation_transition_v1(
                current_commitments,
                commitments,
                &deriver_a,
                &deriver_b,
            )
            .map_err(candidate_derivation_error)
            .map_err(stored_refresh_record_error)?;
            let stored_root = decode_fixed_base64url_32(
                "stored tenant-root refresh installation root commitment",
                &root_commitment_b64u,
            )?;
            if stored_root != *next_commitments.root_commitment() {
                return Err(malformed_input(
                    "stored tenant-root refresh installation root commitment is invalid",
                ));
            }
            Ok(ValidatedTenantRootRefreshInstallationStateV1::BothRoles {
                deriver_a_command_digest,
                deriver_b_command_digest,
                deriver_a: Box::new(deriver_a),
                deriver_b: Box::new(deriver_b),
                root_commitment: stored_root,
            })
        }
    }
}

pub(super) fn decode_protocol_digest_b64u(
    field: &str,
    encoded: &str,
) -> RouterAbProtocolResult<TenantRootProtocolDigestV1> {
    TenantRootProtocolDigestV1::from_bytes(decode_fixed_base64url_32(field, encoded)?)
        .map_err(candidate_derivation_error)
}

pub(super) fn require_fresh_refresh_command(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    context: &TenantRootCeremonyContextV1,
    now_ms: u64,
) -> RouterAbProtocolResult<()> {
    command.require_fresh(now_ms).map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "tenant-root refresh command is outside its freshness window",
        )
    })?;
    context.validate_at(now_ms).map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "tenant-root refresh ceremony context is outside its freshness window",
        )
    })
}

pub(super) fn require_fresh_refresh_commitment_command(
    existing: Option<&TenantRootRefreshCommitmentCheckpointV1>,
    candidate_role: TwoPartyDeriverRole,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    context: &TenantRootCeremonyContextV1,
    now_ms: u64,
) -> RouterAbProtocolResult<()> {
    let requires_fresh = match existing {
        None => true,
        Some(checkpoint) => match checkpoint.state() {
            TenantRootRefreshCommitmentCheckpointStateV1::OneRoleCommitted { role, .. } => {
                *role != candidate_role
            }
            TenantRootRefreshCommitmentCheckpointStateV1::BothRolesCommitted { .. } => false,
        },
    };
    if requires_fresh {
        require_fresh_refresh_command(command, context, now_ms)?;
    }
    Ok(())
}

pub(super) enum ValidatedTenantRootRefreshContributionRendezvousStateV1 {
    OneRole {
        role: TwoPartyDeriverRole,
        command_digest: TenantRootProtocolDigestV1,
        contribution: VerifiedTenantRootSignedRefreshContributionV1,
    },
    BothRoles {
        deriver_a_command_digest: TenantRootProtocolDigestV1,
        deriver_b_command_digest: TenantRootProtocolDigestV1,
        deriver_a: VerifiedTenantRootSignedRefreshContributionV1,
        deriver_b: VerifiedTenantRootSignedRefreshContributionV1,
    },
}

pub(super) fn validate_refresh_contribution_rendezvous(
    record: CloudflareTenantRootRefreshContributionRendezvousRecordV1,
    expected_scope: &CloudflareTenantRootRefreshCheckpointScopeV1,
    context: &TenantRootCeremonyContextV1,
    commitments: &VerifiedTenantRootRefreshCommitmentPairV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<ValidatedTenantRootRefreshContributionRendezvousStateV1> {
    if &record.scope != expected_scope {
        return Err(malformed_input(
            "stored tenant-root refresh contribution rendezvous scope is invalid",
        ));
    }
    match record.state {
        CloudflareTenantRootRefreshContributionRendezvousStateV1::OneRoleContributed {
            role,
            command_digest_b64u,
            signed_contribution_b64u,
        } => {
            let command_digest = decode_protocol_digest_b64u(
                "stored tenant-root refresh contribution command digest",
                &command_digest_b64u,
            )?;
            let contribution_bytes = decode_canonical_base64url(
                "stored tenant-root signed refresh contribution",
                &signed_contribution_b64u,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BASE64URL_BYTES_V1,
            )?;
            let contribution = verify_refresh_contribution_wire(
                &contribution_bytes,
                context,
                commitments,
                role_keys,
            )?;
            if contribution.source() != role.to_protocol() {
                return Err(malformed_input(
                    "stored tenant-root refresh contribution role does not match its wire",
                ));
            }
            Ok(
                ValidatedTenantRootRefreshContributionRendezvousStateV1::OneRole {
                    role: role.to_protocol(),
                    command_digest,
                    contribution,
                },
            )
        }
        CloudflareTenantRootRefreshContributionRendezvousStateV1::BothRolesContributed {
            deriver_a_command_digest_b64u,
            deriver_b_command_digest_b64u,
            deriver_a_signed_contribution_b64u,
            deriver_b_signed_contribution_b64u,
        } => {
            let deriver_a_command_digest = decode_protocol_digest_b64u(
                "stored tenant-root refresh Deriver A contribution command digest",
                &deriver_a_command_digest_b64u,
            )?;
            let deriver_b_command_digest = decode_protocol_digest_b64u(
                "stored tenant-root refresh Deriver B contribution command digest",
                &deriver_b_command_digest_b64u,
            )?;
            let deriver_a_bytes = decode_canonical_base64url(
                "stored tenant-root refresh Deriver A contribution",
                &deriver_a_signed_contribution_b64u,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BASE64URL_BYTES_V1,
            )?;
            let deriver_b_bytes = decode_canonical_base64url(
                "stored tenant-root refresh Deriver B contribution",
                &deriver_b_signed_contribution_b64u,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BASE64URL_BYTES_V1,
            )?;
            let deriver_a = verify_refresh_contribution_wire(
                &deriver_a_bytes,
                context,
                commitments,
                role_keys,
            )?;
            let deriver_b = verify_refresh_contribution_wire(
                &deriver_b_bytes,
                context,
                commitments,
                role_keys,
            )?;
            if deriver_a.source() != TwoPartyDeriverRole::DeriverA
                || deriver_b.source() != TwoPartyDeriverRole::DeriverB
            {
                return Err(malformed_input(
                    "stored tenant-root refresh contribution pair roles are invalid",
                ));
            }
            Ok(
                ValidatedTenantRootRefreshContributionRendezvousStateV1::BothRoles {
                    deriver_a_command_digest,
                    deriver_b_command_digest,
                    deriver_a,
                    deriver_b,
                },
            )
        }
    }
}

pub(super) enum TenantRootRefreshContributionRendezvousEvaluationV1 {
    Commit {
        record: CloudflareTenantRootRefreshContributionRendezvousRecordV1,
        outcome: CloudflareTenantRootRefreshContributionResponseOutcomeV1,
    },
    Replay(CloudflareTenantRootRefreshContributionResponseOutcomeV1),
}

pub(super) fn refresh_contribution_pair_outcome(
    deriver_a: &VerifiedTenantRootSignedRefreshContributionV1,
    deriver_b: &VerifiedTenantRootSignedRefreshContributionV1,
) -> CloudflareTenantRootRefreshContributionResponseOutcomeV1 {
    CloudflareTenantRootRefreshContributionResponseOutcomeV1::BothRolesContributed {
        deriver_a_signed_contribution_b64u: encode_base64url_bytes_v1(deriver_a.canonical_bytes()),
        deriver_b_signed_contribution_b64u: encode_base64url_bytes_v1(deriver_b.canonical_bytes()),
    }
}

pub(super) fn evaluate_refresh_contribution_rendezvous(
    existing: Option<CloudflareTenantRootRefreshContributionRendezvousRecordV1>,
    candidate: VerifiedTenantRootSignedRefreshContributionV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    active: &ValidatedTenantRootRefreshActiveStateV1,
    context: &TenantRootCeremonyContextV1,
    commitments: &VerifiedTenantRootRefreshCommitmentPairV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    now_ms: u64,
) -> RouterAbProtocolResult<TenantRootRefreshContributionRendezvousEvaluationV1> {
    require_refresh_fence_matches_command(&active.record.fence, command)?;
    let scope = refresh_checkpoint_scope(command, active, context, expected_authority_id)?;
    let candidate_role = candidate.source();
    if candidate_role != command.role() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh contribution role does not match its command",
        ));
    }
    let candidate_command_digest = command.digest();
    let candidate_bytes = candidate.canonical_bytes();
    let Some(existing) = existing else {
        require_fresh_refresh_command(command, context, now_ms)?;
        let record = CloudflareTenantRootRefreshContributionRendezvousRecordV1 {
            scope,
            state: CloudflareTenantRootRefreshContributionRendezvousStateV1::OneRoleContributed {
                role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(candidate_role),
                command_digest_b64u: encode_base64url_bytes_v1(candidate_command_digest.as_bytes()),
                signed_contribution_b64u: encode_base64url_bytes_v1(candidate_bytes),
            },
        };
        return Ok(
            TenantRootRefreshContributionRendezvousEvaluationV1::Commit {
                record,
                outcome: CloudflareTenantRootRefreshContributionResponseOutcomeV1::WaitingForPeer {
                    role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(
                        candidate_role,
                    ),
                },
            },
        );
    };
    let existing =
        validate_refresh_contribution_rendezvous(existing, &scope, context, commitments, role_keys)
            .map_err(stored_refresh_record_error)?;
    match existing {
        ValidatedTenantRootRefreshContributionRendezvousStateV1::OneRole {
            role,
            command_digest,
            contribution,
        } => {
            if role == candidate_role {
                if command_digest != candidate_command_digest
                    || contribution.canonical_bytes() != candidate_bytes
                {
                    return Err(refresh_replay_conflict(
                        "tenant-root refresh contribution retry does not match the accepted command and wire",
                    ));
                }
                return Ok(TenantRootRefreshContributionRendezvousEvaluationV1::Replay(
                    CloudflareTenantRootRefreshContributionResponseOutcomeV1::WaitingForPeer {
                        role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(role),
                    },
                ));
            }
            require_fresh_refresh_command(command, context, now_ms)?;
            let (deriver_a_command_digest, deriver_b_command_digest, deriver_a, deriver_b) =
                match candidate_role {
                    TwoPartyDeriverRole::DeriverA => (
                        candidate_command_digest,
                        command_digest,
                        candidate,
                        contribution,
                    ),
                    TwoPartyDeriverRole::DeriverB => (
                        command_digest,
                        candidate_command_digest,
                        contribution,
                        candidate,
                    ),
                };
            let outcome = refresh_contribution_pair_outcome(&deriver_a, &deriver_b);
            let record = CloudflareTenantRootRefreshContributionRendezvousRecordV1 {
                scope,
                state:
                    CloudflareTenantRootRefreshContributionRendezvousStateV1::BothRolesContributed {
                        deriver_a_command_digest_b64u: encode_base64url_bytes_v1(
                            deriver_a_command_digest.as_bytes(),
                        ),
                        deriver_b_command_digest_b64u: encode_base64url_bytes_v1(
                            deriver_b_command_digest.as_bytes(),
                        ),
                        deriver_a_signed_contribution_b64u: encode_base64url_bytes_v1(
                            deriver_a.canonical_bytes(),
                        ),
                        deriver_b_signed_contribution_b64u: encode_base64url_bytes_v1(
                            deriver_b.canonical_bytes(),
                        ),
                    },
            };
            Ok(TenantRootRefreshContributionRendezvousEvaluationV1::Commit { record, outcome })
        }
        ValidatedTenantRootRefreshContributionRendezvousStateV1::BothRoles {
            deriver_a_command_digest,
            deriver_b_command_digest,
            deriver_a,
            deriver_b,
        } => {
            let accepted_command_digest = match candidate_role {
                TwoPartyDeriverRole::DeriverA => deriver_a_command_digest,
                TwoPartyDeriverRole::DeriverB => deriver_b_command_digest,
            };
            let accepted_contribution = match candidate_role {
                TwoPartyDeriverRole::DeriverA => &deriver_a,
                TwoPartyDeriverRole::DeriverB => &deriver_b,
            };
            if accepted_command_digest != candidate_command_digest
                || accepted_contribution.canonical_bytes() != candidate_bytes
            {
                return Err(refresh_replay_conflict(
                    "tenant-root refresh contribution pair retry does not match the accepted command and wire",
                ));
            }
            let outcome = match candidate_role {
                TwoPartyDeriverRole::DeriverA => {
                    refresh_contribution_pair_outcome(accepted_contribution, &deriver_b)
                }
                TwoPartyDeriverRole::DeriverB => {
                    refresh_contribution_pair_outcome(&deriver_a, accepted_contribution)
                }
            };
            Ok(TenantRootRefreshContributionRendezvousEvaluationV1::Replay(
                outcome,
            ))
        }
    }
}

pub(super) enum TenantRootRefreshInstallationCheckpointEvaluationV1 {
    Commit {
        checkpoint: CloudflareTenantRootRefreshInstallationCheckpointRecordV1,
        fence: CloudflareTenantRootRefreshFenceV1,
        outcome: CloudflareTenantRootRefreshInstallationResponseOutcomeV1,
    },
    Replay(CloudflareTenantRootRefreshInstallationResponseOutcomeV1),
}

pub(super) fn evaluate_refresh_installation_checkpoint(
    existing: Option<CloudflareTenantRootRefreshInstallationCheckpointRecordV1>,
    candidate_bytes: &[u8],
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    active: &ValidatedTenantRootRefreshActiveStateV1,
    context: &TenantRootCeremonyContextV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    commitments: &VerifiedTenantRootRefreshCommitmentPairV1,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    terminal_receipt: &VerifiedTenantRootRefreshInstallationReceiptV1,
    _now_ms: u64,
) -> RouterAbProtocolResult<TenantRootRefreshInstallationCheckpointEvaluationV1> {
    require_refresh_fence_matches_command(&active.record.fence, command)?;
    let scope = refresh_checkpoint_scope(command, active, context, expected_authority_id)?;
    let encoded_candidate = encode_base64url_bytes_v1(candidate_bytes);
    let candidate =
        validate_refresh_installation_evidence_candidate(&encoded_candidate, context, role_keys)?;
    terminal_receipt.require_matches(candidate_bytes, command, context)?;
    if candidate.evidence().transcript().role() != command.role() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh installation evidence role does not match its command",
        ));
    }
    let candidate_role = candidate.evidence().transcript().role();
    let candidate_command_digest = command.digest();
    let Some(existing) = existing else {
        let checkpoint = refresh_installation_checkpoint_record(
            scope,
            CloudflareTenantRootRefreshInstallationCheckpointStateV1::OneRoleReady {
                role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(candidate_role),
                command_digest_b64u: encode_base64url_bytes_v1(candidate_command_digest.as_bytes()),
                signed_evidence_b64u: encoded_candidate,
            },
        );
        let fence = refresh_executed_fence(&active.record.fence, command)?;
        return Ok(
            TenantRootRefreshInstallationCheckpointEvaluationV1::Commit {
                checkpoint,
                fence,
                outcome: CloudflareTenantRootRefreshInstallationResponseOutcomeV1::WaitingForPeer {
                    role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(
                        candidate_role,
                    ),
                },
            },
        );
    };
    let existing = validate_refresh_installation_checkpoint(
        existing,
        &scope,
        context,
        role_keys,
        commitments,
        &active.commitments,
    )
    .map_err(stored_refresh_record_error)?;
    match existing {
        ValidatedTenantRootRefreshInstallationStateV1::OneRole {
            role,
            command_digest,
            evidence,
        } => {
            if role == candidate_role {
                if command_digest != candidate_command_digest
                    || evidence.canonical_bytes() != candidate_bytes
                {
                    return Err(refresh_replay_conflict(
                        "tenant-root refresh installation retry does not match the accepted command and wire",
                    ));
                }
                return Ok(TenantRootRefreshInstallationCheckpointEvaluationV1::Replay(
                    CloudflareTenantRootRefreshInstallationResponseOutcomeV1::WaitingForPeer {
                        role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(role),
                    },
                ));
            }
            let (deriver_a, deriver_b) = match candidate_role {
                TwoPartyDeriverRole::DeriverA => (candidate, *evidence),
                TwoPartyDeriverRole::DeriverB => (*evidence, candidate),
            };
            let next_commitments = verify_tenant_root_refresh_installation_transition_v1(
                &active.commitments,
                commitments,
                &deriver_a,
                &deriver_b,
            )
            .map_err(refresh_installation_transition_error)?;
            let root_commitment = *next_commitments.root_commitment();
            let (deriver_a_command_digest, deriver_b_command_digest) = match candidate_role {
                TwoPartyDeriverRole::DeriverA => (candidate_command_digest, command_digest),
                TwoPartyDeriverRole::DeriverB => (command_digest, candidate_command_digest),
            };
            let checkpoint = refresh_installation_checkpoint_record(
                scope,
                CloudflareTenantRootRefreshInstallationCheckpointStateV1::BothRolesReady {
                    deriver_a_command_digest_b64u: encode_base64url_bytes_v1(
                        deriver_a_command_digest.as_bytes(),
                    ),
                    deriver_b_command_digest_b64u: encode_base64url_bytes_v1(
                        deriver_b_command_digest.as_bytes(),
                    ),
                    deriver_a_signed_evidence_b64u: encode_base64url_bytes_v1(
                        deriver_a.canonical_bytes(),
                    ),
                    deriver_b_signed_evidence_b64u: encode_base64url_bytes_v1(
                        deriver_b.canonical_bytes(),
                    ),
                    root_commitment_b64u: encode_base64url_bytes_v1(&root_commitment),
                },
            );
            let fence = refresh_executed_fence(&active.record.fence, command)?;
            Ok(
                TenantRootRefreshInstallationCheckpointEvaluationV1::Commit {
                    checkpoint,
                    fence,
                    outcome:
                        CloudflareTenantRootRefreshInstallationResponseOutcomeV1::BothRolesReady {
                            root_commitment_b64u: encode_base64url_bytes_v1(&root_commitment),
                        },
                },
            )
        }
        ValidatedTenantRootRefreshInstallationStateV1::BothRoles {
            deriver_a_command_digest,
            deriver_b_command_digest,
            deriver_a,
            deriver_b,
            root_commitment,
        } => {
            let accepted_digest = match candidate_role {
                TwoPartyDeriverRole::DeriverA => deriver_a_command_digest,
                TwoPartyDeriverRole::DeriverB => deriver_b_command_digest,
            };
            let accepted = match candidate_role {
                TwoPartyDeriverRole::DeriverA => deriver_a,
                TwoPartyDeriverRole::DeriverB => deriver_b,
            };
            if accepted_digest != candidate_command_digest
                || accepted.canonical_bytes() != candidate_bytes
            {
                return Err(refresh_replay_conflict(
                    "tenant-root refresh installation pair retry does not match the accepted command and wire",
                ));
            }
            Ok(TenantRootRefreshInstallationCheckpointEvaluationV1::Replay(
                CloudflareTenantRootRefreshInstallationResponseOutcomeV1::BothRolesReady {
                    root_commitment_b64u: encode_base64url_bytes_v1(&root_commitment),
                },
            ))
        }
    }
}

pub(super) fn refresh_installation_transition_error(_error: RouterAbDerivationError) -> RouterAbProtocolError {
    refresh_replay_conflict(
        "tenant-root refresh installation evidence conflicts with the accepted refresh transition",
    )
}

pub(super) fn refresh_installation_checkpoint_record(
    scope: CloudflareTenantRootRefreshCheckpointScopeV1,
    state: CloudflareTenantRootRefreshInstallationCheckpointStateV1,
) -> CloudflareTenantRootRefreshInstallationCheckpointRecordV1 {
    CloudflareTenantRootRefreshInstallationCheckpointRecordV1 { scope, state }
}

pub(super) fn refresh_replay_conflict(message: &'static str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::ConflictingPair, message)
}

pub(super) fn stored_refresh_record_error(error: RouterAbProtocolError) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!(
            "stored tenant-root refresh checkpoint is invalid: {:?}",
            error.code()
        ),
    )
}

pub(crate) async fn tenant_root_refresh_commitment_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    commitment: &VerifiedTenantRootRefreshCommitmentV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshCommitmentResponseV1> {
    let context = commitment.transcript().context();
    let context_digest = context.digest().map_err(candidate_derivation_error)?;
    if command.refresh_context_digest() != context_digest || command.role() != commitment.role() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh commitment does not match its command",
        ));
    }
    let authority_id = command.authority_id();
    let request = CloudflareTenantRootRefreshCommitmentRequestV1 {
        role_refresh_command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
        signed_commitment_b64u: encode_base64url_bytes_v1(commitment.canonical_bytes()),
    };
    let response = state.creation_state_call(
            authority_id,
        command.identity_digest(),
        command.custody_lineage(),
        CLOUDFLARE_TENANT_ROOT_REFRESH_COMMITMENT_CHECKPOINT_PATH,
        "tenant-root refresh commitment checkpoint",
        &request,
        TENANT_ROOT_REFRESH_COMMITMENT_REQUEST_MAX_BYTES_V1,
        TENANT_ROOT_REFRESH_COMMITMENT_RESPONSE_MAX_BYTES_V1,
    )
    .await?;
    validate_refresh_commitment_response(
        &response,
        command,
        commitment.canonical_bytes(),
        context,
    )?;
    Ok(response)
}

/// Sends one role-signed, recipient-bound encrypted refresh contribution to the
/// Router-owned public rendezvous after both commitments have completed.
pub(crate) async fn tenant_root_refresh_contribution_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    commitments: &VerifiedTenantRootRefreshCommitmentPairV1,
    contribution: &VerifiedTenantRootSignedRefreshContributionV1,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshContributionResponseV1> {
    let context = commitments.context();
    let context_digest = context.digest().map_err(candidate_derivation_error)?;
    if command.refresh_context_digest() != context_digest || command.role() != contribution.source()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh contribution does not match its command or commitment pair",
        ));
    }
    let contribution_bytes = contribution.canonical_bytes();
    verify_refresh_contribution_wire(contribution_bytes, context, commitments, role_keys)?;
    let request = CloudflareTenantRootRefreshContributionRequestV1 {
        role_refresh_command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
        signed_contribution_b64u: encode_base64url_bytes_v1(contribution_bytes),
    };
    let response = state.creation_state_call(
            command.authority_id(),
        command.identity_digest(),
        command.custody_lineage(),
        CLOUDFLARE_TENANT_ROOT_REFRESH_CONTRIBUTION_RENDEZVOUS_PATH,
        "tenant-root refresh contribution rendezvous",
        &request,
        TENANT_ROOT_REFRESH_CONTRIBUTION_REQUEST_MAX_BYTES_V1,
        TENANT_ROOT_REFRESH_CONTRIBUTION_RESPONSE_MAX_BYTES_V1,
    )
    .await?;
    validate_refresh_contribution_response(
        &response,
        command,
        commitments,
        context,
        contribution_bytes,
        role_keys,
    )?;
    Ok(response)
}

pub(crate) async fn tenant_root_refresh_installation_call_v1(
    state: &impl TenantRootCreationStateTransportV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    terminal_receipt_bytes: &[u8],
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshInstallationResponseV1> {
    let context = evidence.evidence().transcript().context();
    let context_digest = context.digest().map_err(candidate_derivation_error)?;
    if command.refresh_context_digest() != context_digest
        || command.role() != evidence.evidence().transcript().role()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh installation evidence does not match its command",
        ));
    }
    let request = CloudflareTenantRootRefreshInstallationRequestV1 {
        role_refresh_command_b64u: encode_base64url_bytes_v1(command.canonical_bytes()),
        signed_evidence_b64u: encode_base64url_bytes_v1(evidence.canonical_bytes()),
        terminal_receipt_b64u: encode_base64url_bytes_v1(terminal_receipt_bytes),
    };
    let response = state.creation_state_call(
            command.authority_id(),
        command.identity_digest(),
        command.custody_lineage(),
        CLOUDFLARE_TENANT_ROOT_REFRESH_INSTALLATION_CHECKPOINT_PATH,
        "tenant-root refresh installation checkpoint",
        &request,
        TENANT_ROOT_REFRESH_INSTALLATION_REQUEST_MAX_BYTES_V1,
        TENANT_ROOT_REFRESH_INSTALLATION_RESPONSE_MAX_BYTES_V1,
    )
    .await?;
    validate_refresh_installation_response(&response, command, context)?;
    Ok(response)
}

pub(super) fn validate_refresh_commitment_response(
    response: &CloudflareTenantRootRefreshCommitmentResponseV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    candidate_bytes: &[u8],
    context: &TenantRootCeremonyContextV1,
) -> RouterAbProtocolResult<()> {
    validate_refresh_response_scope(response, command, context)?;
    match &response.outcome {
        CloudflareTenantRootRefreshCommitmentResponseOutcomeV1::WaitingForPeer {
            role,
            signed_commitment_b64u,
        } => {
            if role.to_protocol() != command.role() {
                return Err(malformed_input(
                    "tenant-root refresh commitment response role is invalid",
                ));
            }
            let returned = decode_canonical_base64url(
                "tenant-root refresh commitment response signed commitment",
                signed_commitment_b64u,
                TENANT_ROOT_REFRESH_COMMITMENT_MAX_BYTES_V1,
                TENANT_ROOT_REFRESH_COMMITMENT_MAX_BASE64URL_BYTES_V1,
            )?;
            if returned != candidate_bytes {
                return Err(malformed_input(
                    "tenant-root refresh commitment response does not replay the submitted wire",
                ));
            }
            let signed = TenantRootSignedRefreshCommitmentV1::decode_canonical_bytes(&returned)
                .map_err(candidate_derivation_error)?;
            if signed.role() != command.role() || signed.transcript().context() != context {
                return Err(malformed_input(
                    "tenant-root refresh commitment response wire is out of scope",
                ));
            }
        }
        CloudflareTenantRootRefreshCommitmentResponseOutcomeV1::BothRolesCommitted {
            deriver_a_signed_commitment_b64u,
            deriver_b_signed_commitment_b64u,
            pair_digest_b64u,
        } => {
            let deriver_a = decode_canonical_base64url(
                "tenant-root refresh response Deriver A commitment",
                deriver_a_signed_commitment_b64u,
                TENANT_ROOT_REFRESH_COMMITMENT_MAX_BYTES_V1,
                TENANT_ROOT_REFRESH_COMMITMENT_MAX_BASE64URL_BYTES_V1,
            )?;
            let deriver_b = decode_canonical_base64url(
                "tenant-root refresh response Deriver B commitment",
                deriver_b_signed_commitment_b64u,
                TENANT_ROOT_REFRESH_COMMITMENT_MAX_BYTES_V1,
                TENANT_ROOT_REFRESH_COMMITMENT_MAX_BASE64URL_BYTES_V1,
            )?;
            let deriver_a_signed =
                TenantRootSignedRefreshCommitmentV1::decode_canonical_bytes(&deriver_a)
                    .map_err(candidate_derivation_error)?;
            let deriver_b_signed =
                TenantRootSignedRefreshCommitmentV1::decode_canonical_bytes(&deriver_b)
                    .map_err(candidate_derivation_error)?;
            if deriver_a_signed.role() != TwoPartyDeriverRole::DeriverA
                || deriver_b_signed.role() != TwoPartyDeriverRole::DeriverB
                || deriver_a_signed.transcript().context() != context
                || deriver_b_signed.transcript().context() != context
            {
                return Err(malformed_input(
                    "tenant-root refresh commitment response pair is out of scope",
                ));
            }
            let expected_digest =
                refresh_commitment_pair_digest_from_bytes(&deriver_a, &deriver_b)?;
            validate_response_digest(
                "tenant-root refresh commitment response pair digest",
                pair_digest_b64u,
                expected_digest,
            )?;
            if deriver_a != candidate_bytes && deriver_b != candidate_bytes {
                return Err(malformed_input(
                    "tenant-root refresh commitment response pair omits the submitted wire",
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_refresh_installation_response(
    response: &CloudflareTenantRootRefreshInstallationResponseV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    context: &TenantRootCeremonyContextV1,
) -> RouterAbProtocolResult<()> {
    validate_refresh_response_scope(response, command, context)?;
    if let CloudflareTenantRootRefreshInstallationResponseOutcomeV1::WaitingForPeer { role } =
        &response.outcome
    {
        if role.to_protocol() != command.role() {
            return Err(malformed_input(
                "tenant-root refresh installation response role is invalid",
            ));
        }
    }
    if let CloudflareTenantRootRefreshInstallationResponseOutcomeV1::BothRolesReady {
        root_commitment_b64u,
    } = &response.outcome
    {
        let _ = decode_fixed_base64url_32(
            "tenant-root refresh installation response root commitment",
            root_commitment_b64u,
        )?;
    }
    Ok(())
}

pub(super) fn validate_refresh_contribution_response(
    response: &CloudflareTenantRootRefreshContributionResponseV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    commitments: &VerifiedTenantRootRefreshCommitmentPairV1,
    context: &TenantRootCeremonyContextV1,
    candidate_bytes: &[u8],
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<()> {
    validate_refresh_response_scope(response, command, context)?;
    match &response.outcome {
        CloudflareTenantRootRefreshContributionResponseOutcomeV1::WaitingForPeer { role } => {
            if role.to_protocol() != command.role() {
                return Err(malformed_input(
                    "tenant-root refresh contribution response role is invalid",
                ));
            }
        }
        CloudflareTenantRootRefreshContributionResponseOutcomeV1::BothRolesContributed {
            deriver_a_signed_contribution_b64u,
            deriver_b_signed_contribution_b64u,
        } => {
            let deriver_a = decode_canonical_base64url(
                "tenant-root refresh response Deriver A contribution",
                deriver_a_signed_contribution_b64u,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BASE64URL_BYTES_V1,
            )?;
            let deriver_b = decode_canonical_base64url(
                "tenant-root refresh response Deriver B contribution",
                deriver_b_signed_contribution_b64u,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BYTES_V1,
                TENANT_ROOT_REFRESH_CONTRIBUTION_MAX_BASE64URL_BYTES_V1,
            )?;
            let verified_a =
                verify_refresh_contribution_wire(&deriver_a, context, commitments, role_keys)?;
            let verified_b =
                verify_refresh_contribution_wire(&deriver_b, context, commitments, role_keys)?;
            if verified_a.source() != TwoPartyDeriverRole::DeriverA
                || verified_b.source() != TwoPartyDeriverRole::DeriverB
            {
                return Err(malformed_input(
                    "tenant-root refresh contribution response pair roles are invalid",
                ));
            }
            let expected_candidate = match command.role() {
                TwoPartyDeriverRole::DeriverA => &deriver_a,
                TwoPartyDeriverRole::DeriverB => &deriver_b,
            };
            if expected_candidate.as_slice() != candidate_bytes {
                return Err(malformed_input(
                    "tenant-root refresh contribution response pair omits the submitted wire",
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_refresh_response_scope<T>(
    response: &T,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    context: &TenantRootCeremonyContextV1,
) -> RouterAbProtocolResult<()>
where
    T: RefreshResponseScopeView,
{
    validate_response_digest(
        "tenant-root refresh response command digest",
        response.command_digest_b64u(),
        command.digest(),
    )?;
    validate_response_digest(
        "tenant-root refresh response identity digest",
        response.identity_digest_b64u(),
        TenantRootProtocolDigestV1::from_bytes(*command.identity_digest().as_bytes())
            .map_err(candidate_derivation_error)?,
    )?;
    validate_response_lineage(
        "tenant-root refresh response custody lineage",
        response.custody_lineage_b64u(),
        command.custody_lineage(),
    )?;
    validate_response_fixed_bytes(
        "tenant-root refresh response authority id",
        response.authority_id_b64u(),
        command.authority_id().as_bytes(),
    )?;
    validate_response_digest(
        "tenant-root refresh response ceremony context digest",
        response.ceremony_context_digest_b64u(),
        context.digest().map_err(candidate_derivation_error)?,
    )?;
    if response.current_epoch() != command.current_epoch().get().get()
        || response.next_epoch() != command.next_epoch().get().get()
        || response.expected_control_plane_revision() != command.expected_control_plane_revision()
    {
        return Err(malformed_input(
            "tenant-root refresh response scope does not match its command",
        ));
    }
    validate_response_fixed_bytes(
        "tenant-root refresh response active root commitment",
        response.active_root_commitment_b64u(),
        command.active_root_commitment(),
    )?;
    let expected_receipt_digest = command.active_activation_receipt_digest();
    validate_response_fixed_bytes(
        "tenant-root refresh response active activation receipt digest",
        response.active_activation_receipt_digest_b64u(),
        expected_receipt_digest.as_bytes(),
    )
}

pub(super) trait RefreshResponseScopeView {
    fn command_digest_b64u(&self) -> &str;
    fn identity_digest_b64u(&self) -> &str;
    fn custody_lineage_b64u(&self) -> &str;
    fn authority_id_b64u(&self) -> &str;
    fn ceremony_context_digest_b64u(&self) -> &str;
    fn current_epoch(&self) -> u64;
    fn next_epoch(&self) -> u64;
    fn expected_control_plane_revision(&self) -> u64;
    fn active_root_commitment_b64u(&self) -> &str;
    fn active_activation_receipt_digest_b64u(&self) -> &str;
}

impl RefreshResponseScopeView for CloudflareTenantRootRefreshCommitmentResponseV1 {
    fn command_digest_b64u(&self) -> &str {
        &self.command_digest_b64u
    }
    fn identity_digest_b64u(&self) -> &str {
        &self.identity_digest_b64u
    }
    fn custody_lineage_b64u(&self) -> &str {
        &self.custody_lineage_b64u
    }
    fn authority_id_b64u(&self) -> &str {
        &self.authority_id_b64u
    }
    fn ceremony_context_digest_b64u(&self) -> &str {
        &self.ceremony_context_digest_b64u
    }
    fn current_epoch(&self) -> u64 {
        self.current_epoch
    }
    fn next_epoch(&self) -> u64 {
        self.next_epoch
    }
    fn expected_control_plane_revision(&self) -> u64 {
        self.expected_control_plane_revision
    }
    fn active_root_commitment_b64u(&self) -> &str {
        &self.active_root_commitment_b64u
    }
    fn active_activation_receipt_digest_b64u(&self) -> &str {
        &self.active_activation_receipt_digest_b64u
    }
}

impl RefreshResponseScopeView for CloudflareTenantRootRefreshInstallationResponseV1 {
    fn command_digest_b64u(&self) -> &str {
        &self.command_digest_b64u
    }
    fn identity_digest_b64u(&self) -> &str {
        &self.identity_digest_b64u
    }
    fn custody_lineage_b64u(&self) -> &str {
        &self.custody_lineage_b64u
    }
    fn authority_id_b64u(&self) -> &str {
        &self.authority_id_b64u
    }
    fn ceremony_context_digest_b64u(&self) -> &str {
        &self.ceremony_context_digest_b64u
    }
    fn current_epoch(&self) -> u64 {
        self.current_epoch
    }
    fn next_epoch(&self) -> u64 {
        self.next_epoch
    }
    fn expected_control_plane_revision(&self) -> u64 {
        self.expected_control_plane_revision
    }
    fn active_root_commitment_b64u(&self) -> &str {
        &self.active_root_commitment_b64u
    }
    fn active_activation_receipt_digest_b64u(&self) -> &str {
        &self.active_activation_receipt_digest_b64u
    }
}

impl RefreshResponseScopeView for CloudflareTenantRootRefreshContributionResponseV1 {
    fn command_digest_b64u(&self) -> &str {
        &self.command_digest_b64u
    }
    fn identity_digest_b64u(&self) -> &str {
        &self.identity_digest_b64u
    }
    fn custody_lineage_b64u(&self) -> &str {
        &self.custody_lineage_b64u
    }
    fn authority_id_b64u(&self) -> &str {
        &self.authority_id_b64u
    }
    fn ceremony_context_digest_b64u(&self) -> &str {
        &self.ceremony_context_digest_b64u
    }
    fn current_epoch(&self) -> u64 {
        self.current_epoch
    }
    fn next_epoch(&self) -> u64 {
        self.next_epoch
    }
    fn expected_control_plane_revision(&self) -> u64 {
        self.expected_control_plane_revision
    }
    fn active_root_commitment_b64u(&self) -> &str {
        &self.active_root_commitment_b64u
    }
    fn active_activation_receipt_digest_b64u(&self) -> &str {
        &self.active_activation_receipt_digest_b64u
    }
}

pub(super) fn validate_response_fixed_bytes(
    field: &str,
    encoded: &str,
    expected: &[u8],
) -> RouterAbProtocolResult<()> {
    let decoded = decode_canonical_base64url(
        field,
        encoded,
        expected.len(),
        base64url_len_for_bytes(expected.len()),
    )?;
    if decoded != expected {
        return Err(malformed_input(format!(
            "{field} does not match the authenticated refresh scope"
        )));
    }
    Ok(())
}

pub(super) fn refresh_commitment_pair_digest_from_bytes(
    deriver_a: &[u8],
    deriver_b: &[u8],
) -> RouterAbProtocolResult<TenantRootProtocolDigestV1> {
    let mut hasher = Sha256::new();
    hasher.update(b"tenant_root_refresh_commitment_pair_v1");
    hasher.update(
        u32::try_from(deriver_a.len())
            .map_err(|_| malformed_input("tenant-root refresh commitment wire is too long"))?
            .to_be_bytes(),
    );
    hasher.update(deriver_a);
    hasher.update(
        u32::try_from(deriver_b.len())
            .map_err(|_| malformed_input("tenant-root refresh commitment wire is too long"))?
            .to_be_bytes(),
    );
    hasher.update(deriver_b);
    TenantRootProtocolDigestV1::from_bytes(hasher.finalize().into())
        .map_err(candidate_derivation_error)
}

pub(super) const fn base64url_len_for_bytes(bytes: usize) -> usize {
    (bytes / 3) * 4
        + match bytes % 3 {
            0 => 0,
            1 => 2,
            _ => 3,
        }
}
