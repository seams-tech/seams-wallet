//! Validation and evaluation of the creation journal, commitment rendezvous, installation and cleanup checkpoints.

use super::*;

pub(super) fn tenant_root_creation_identity_v1(
    journal: &TenantRootCreationJournalV1,
) -> RouterAbProtocolResult<TenantRootIdentityV1> {
    match journal {
        TenantRootCreationJournalV1::Started(event) => {
            TenantRootIdentityV1::decode_canonical_bytes(event.identity_canonical_bytes())
                .map_err(candidate_derivation_error)
        }
    }
}

#[derive(Debug)]
#[cfg_attr(not(feature = "workers-rs"), allow(dead_code))]
pub(super) enum TenantRootCreationJournalEvaluationV1 {
    Commit {
        record: CloudflareTenantRootCreationJournalRecordV1,
        response: CloudflareTenantRootCreationJournalResponseV1,
    },
    Replay(CloudflareTenantRootCreationJournalResponseV1),
}

pub(crate) fn validate_creation_record(
    record: CloudflareTenantRootCreationJournalRecordV1,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_verifying_keys: &BTreeMap<String, [u8; 32]>,
) -> RouterAbProtocolResult<ValidatedTenantRootCreationJournalV1> {
    let journal_bytes = decode_canonical_base64url(
        "tenant-root creation journal",
        &record.journal_b64u,
        TENANT_ROOT_CREATION_JOURNAL_MAX_BYTES_V1,
        TENANT_ROOT_CREATION_JOURNAL_MAX_BASE64URL_BYTES_V1,
    )?;
    let journal = TenantRootCreationJournalV1::decode_canonical_bytes(&journal_bytes)
        .map_err(candidate_derivation_error)?;
    let (identity, ceremony_context) = match &journal {
        TenantRootCreationJournalV1::Started(event) => (
            TenantRootIdentityV1::decode_canonical_bytes(event.identity_canonical_bytes())
                .map_err(candidate_derivation_error)?,
            TenantRootCeremonyContextV1::decode_canonical_bytes(
                event.ceremony_context_canonical_bytes(),
            )
            .map_err(candidate_derivation_error)?,
        ),
    };
    journal
        .rebuild(identity, journal.custody_lineage())
        .map_err(candidate_derivation_error)?;
    let journal_digest = journal.digest().map_err(candidate_derivation_error)?;
    let capability_bytes = decode_canonical_base64url(
        "tenant-root creation capability",
        &record.creation_capability_b64u,
        TENANT_ROOT_CREATION_CAPABILITY_MAX_BYTES_V1,
        TENANT_ROOT_CREATION_CAPABILITY_MAX_BASE64URL_BYTES_V1,
    )?;
    let raw_capability = TenantRootCreationCapabilityV1::decode_canonical_bytes(&capability_bytes)
        .map_err(candidate_derivation_error)?;
    let issuer_key_id = raw_capability.issuer_key_id();
    let trusted_issuer_verifying_key = trusted_issuer_verifying_keys
        .get(issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root creation capability issuer is not trusted",
            )
        })?;
    let capability = raw_capability
        .verify(
            journal.identity_digest(),
            journal.custody_lineage(),
            journal_digest,
            journal.revision(),
            authority_id,
            issuer_key_id,
            trusted_issuer_verifying_key,
        )
        .map_err(candidate_authorization_error)?;
    let identity_digest = journal.identity_digest();
    let custody_lineage = journal.custody_lineage();
    let revision = journal.revision();
    Ok(ValidatedTenantRootCreationJournalV1 {
        record,
        journal,
        identity_digest,
        custody_lineage,
        ceremony_context,
        revision,
        journal_digest,
        capability,
    })
}

pub(super) fn evaluate_creation_record(
    existing: Option<CloudflareTenantRootCreationJournalRecordV1>,
    candidate: ValidatedTenantRootCreationJournalV1,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_verifying_keys: &BTreeMap<String, [u8; 32]>,
    now_ms: u64,
) -> RouterAbProtocolResult<TenantRootCreationJournalEvaluationV1> {
    let Some(existing) = existing else {
        candidate.capability.require_fresh(now_ms).map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "tenant-root creation capability is outside its freshness window",
            )
        })?;
        let response = candidate.response(CloudflareTenantRootCreationJournalOutcomeV1::Committed);
        return Ok(TenantRootCreationJournalEvaluationV1::Commit {
            record: candidate.record,
            response,
        });
    };
    let existing_validated =
        validate_creation_record(existing, authority_id, trusted_issuer_verifying_keys)
            .map_err(stored_record_error)?;
    if existing_validated.record != candidate.record {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root creation command conflicts with the accepted command",
        ));
    }
    Ok(TenantRootCreationJournalEvaluationV1::Replay(
        candidate.response(CloudflareTenantRootCreationJournalOutcomeV1::Replay),
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CloudflareTenantRootCreationInstallationRoleV1 {
    DeriverA,
    DeriverB,
}

impl CloudflareTenantRootCreationInstallationRoleV1 {
    pub(super) const fn from_protocol(role: TwoPartyDeriverRole) -> Self {
        match role {
            TwoPartyDeriverRole::DeriverA => Self::DeriverA,
            TwoPartyDeriverRole::DeriverB => Self::DeriverB,
        }
    }

    pub(crate) const fn to_protocol(self) -> TwoPartyDeriverRole {
        match self {
            Self::DeriverA => TwoPartyDeriverRole::DeriverA,
            Self::DeriverB => TwoPartyDeriverRole::DeriverB,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudflareTenantRootCreationCommitmentRendezvousStateV1 {
    OneRoleCommitted {
        role: CloudflareTenantRootCreationInstallationRoleV1,
        signed_commitment_b64u: String,
    },
    BothRolesCommitted {
        deriver_a_signed_commitment_b64u: String,
        deriver_b_signed_commitment_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootCreationCommitmentRendezvousRecordV1 {
    pub(crate) journal_digest_b64u: String,
    pub(crate) identity_digest_b64u: String,
    pub(crate) custody_lineage_b64u: String,
    pub(crate) ceremony_context_digest_b64u: String,
    pub(crate) state: CloudflareTenantRootCreationCommitmentRendezvousStateV1,
}

#[derive(Debug)]
pub(super) enum TenantRootCreationCommitmentRendezvousEvaluationV1 {
    Commit {
        rendezvous: CloudflareTenantRootCreationCommitmentRendezvousRecordV1,
        outcome: CloudflareTenantRootCreationCommitmentOutcomeV1,
    },
    Replay(CloudflareTenantRootCreationCommitmentOutcomeV1),
}

#[derive(Debug)]
#[allow(clippy::large_enum_variant)]
pub(crate) enum CloudflareTenantRootCreationCommitmentOutcomeV1 {
    WaitingForPeer {
        role: CloudflareTenantRootCreationInstallationRoleV1,
    },
    BothRolesCommitted {
        pair: VerifiedTenantRootCreationCommitmentPairV1,
    },
}

#[allow(clippy::large_enum_variant)]
pub(super) enum ValidatedTenantRootCreationCommitmentRendezvousStateV1 {
    OneRoleCommitted {
        role: TwoPartyDeriverRole,
        commitment: VerifiedTenantRootCreationCommitmentV1,
    },
    BothRolesCommitted {
        pair: VerifiedTenantRootCreationCommitmentPairV1,
    },
}

pub(super) struct ValidatedTenantRootCreationCommitmentRendezvousV1 {
    pub(super) state: ValidatedTenantRootCreationCommitmentRendezvousStateV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum CloudflareTenantRootCreationInstallationStateV1 {
    OneRoleReady {
        role: CloudflareTenantRootCreationInstallationRoleV1,
        signed_evidence_b64u: String,
    },
    BothRolesReady {
        deriver_a_signed_evidence_b64u: String,
        deriver_b_signed_evidence_b64u: String,
        root_commitment_b64u: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CloudflareTenantRootCreationInstallationCheckpointV1 {
    pub(super) journal_digest_b64u: String,
    pub(super) identity_digest_b64u: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) ceremony_context_digest_b64u: String,
    pub(super) state: CloudflareTenantRootCreationInstallationStateV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CloudflareTenantRootCreationCleanupCheckpointV1 {
    pub(super) journal_digest_b64u: String,
    pub(super) identity_digest_b64u: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) ceremony_context_digest_b64u: String,
    pub(super) role: CloudflareTenantRootCreationInstallationRoleV1,
    pub(super) cleanup_command_b64u: String,
    pub(super) cleanup_receipt_b64u: String,
    pub(super) cleanup_receipt_digest_b64u: String,
}

pub(super) struct ValidatedTenantRootCreationCleanupCheckpointV1 {
    pub(super) record: CloudflareTenantRootCreationCleanupCheckpointV1,
    pub(super) authorization: router_ab_core::VerifiedTenantRootRoleCleanupCommandV1,
    pub(super) receipt_digest: TenantRootProtocolDigestV1,
}

pub(super) enum TenantRootCreationCleanupEvaluationV1 {
    Commit {
        checkpoint: CloudflareTenantRootCreationCleanupCheckpointV1,
        response: CloudflareTenantRootCreationCleanupResponseV1,
    },
    Replay(CloudflareTenantRootCreationCleanupResponseV1),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootCreationInstallationOutcomeV1 {
    WaitingForPeer {
        role: CloudflareTenantRootCreationInstallationRoleV1,
    },
    BothRolesReady {
        root_commitment_b64u: String,
    },
}

#[derive(Debug)]
pub(super) enum TenantRootCreationInstallationEvaluationV1 {
    Commit {
        checkpoint: CloudflareTenantRootCreationInstallationCheckpointV1,
        outcome: CloudflareTenantRootCreationInstallationOutcomeV1,
    },
    Replay(CloudflareTenantRootCreationInstallationOutcomeV1),
}

pub(super) fn validate_role_creation_command(
    encoded: &str,
    journal: &ValidatedTenantRootCreationJournalV1,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_verifying_keys: &BTreeMap<String, [u8; 32]>,
) -> RouterAbProtocolResult<VerifiedTenantRootRoleCreationCommandV1> {
    let bytes = decode_canonical_base64url(
        "tenant-root role creation command",
        encoded,
        TENANT_ROOT_ROLE_CREATION_COMMAND_MAX_BYTES_V1,
        TENANT_ROOT_ROLE_CREATION_COMMAND_MAX_BASE64URL_BYTES_V1,
    )?;
    let command = TenantRootRoleCreationCommandV1::decode_canonical_bytes(&bytes)
        .map_err(candidate_derivation_error)?;
    let issuer_key_id = command.issuer_key_id();
    let verifying_key = trusted_issuer_verifying_keys
        .get(issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root creation role command issuer is not trusted",
            )
        })?;
    command
        .verify(
            &journal.journal,
            &journal.ceremony_context,
            command.role(),
            authority_id,
            issuer_key_id,
            verifying_key,
        )
        .map_err(candidate_authorization_error)
}

pub(super) fn require_fresh_role_creation_command(
    command: &VerifiedTenantRootRoleCreationCommandV1,
    now_ms: u64,
) -> RouterAbProtocolResult<()> {
    command.require_fresh(now_ms).map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "tenant-root role creation command is outside its freshness window",
        )
    })
}

pub(super) fn validate_creation_commitment_rendezvous(
    record: CloudflareTenantRootCreationCommitmentRendezvousRecordV1,
    journal: &ValidatedTenantRootCreationJournalV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<ValidatedTenantRootCreationCommitmentRendezvousV1> {
    let ceremony_context_digest = journal
        .ceremony_context
        .digest()
        .map_err(candidate_derivation_error)?;
    if record.journal_digest_b64u != encode_base64url_bytes_v1(journal.journal_digest.as_bytes())
        || record.identity_digest_b64u
            != encode_base64url_bytes_v1(journal.identity_digest.as_bytes())
        || record.custody_lineage_b64u != journal.custody_lineage.to_base64url()
        || record.ceremony_context_digest_b64u
            != encode_base64url_bytes_v1(ceremony_context_digest.as_bytes())
    {
        return Err(malformed_input(
            "tenant-root creation commitment rendezvous scope is invalid",
        ));
    }

    let state = match record.state {
        CloudflareTenantRootCreationCommitmentRendezvousStateV1::OneRoleCommitted {
            role,
            signed_commitment_b64u,
        } => {
            let role = role.to_protocol();
            let commitment = validate_creation_commitment_wire(
                &signed_commitment_b64u,
                &journal.ceremony_context,
                role,
                role_keys,
            )?;
            ValidatedTenantRootCreationCommitmentRendezvousStateV1::OneRoleCommitted {
                role,
                commitment,
            }
        }
        CloudflareTenantRootCreationCommitmentRendezvousStateV1::BothRolesCommitted {
            deriver_a_signed_commitment_b64u,
            deriver_b_signed_commitment_b64u,
        } => {
            let deriver_a = validate_creation_commitment_wire(
                &deriver_a_signed_commitment_b64u,
                &journal.ceremony_context,
                TwoPartyDeriverRole::DeriverA,
                role_keys,
            )?;
            let deriver_b = validate_creation_commitment_wire(
                &deriver_b_signed_commitment_b64u,
                &journal.ceremony_context,
                TwoPartyDeriverRole::DeriverB,
                role_keys,
            )?;
            let pair = VerifiedTenantRootCreationCommitmentPairV1::new(deriver_a, deriver_b)
                .map_err(candidate_derivation_error)?;
            ValidatedTenantRootCreationCommitmentRendezvousStateV1::BothRolesCommitted { pair }
        }
    };

    Ok(ValidatedTenantRootCreationCommitmentRendezvousV1 { state })
}

pub(super) fn require_complete_creation_commitment_rendezvous(
    record: Option<CloudflareTenantRootCreationCommitmentRendezvousRecordV1>,
    journal: &ValidatedTenantRootCreationJournalV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootCreationCommitmentPairV1> {
    let record = record.ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root installation checkpoint has no creation commitment rendezvous",
        )
    })?;
    let validated = validate_creation_commitment_rendezvous(record, journal, role_keys)
        .map_err(stored_record_error)?;
    match validated.state {
        ValidatedTenantRootCreationCommitmentRendezvousStateV1::BothRolesCommitted { pair } => {
            Ok(pair)
        }
        ValidatedTenantRootCreationCommitmentRendezvousStateV1::OneRoleCommitted { .. } => {
            Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                "tenant-root installation checkpoint requires both creation commitments",
            ))
        }
    }
}

pub(super) fn evaluate_creation_commitment_rendezvous(
    existing: Option<CloudflareTenantRootCreationCommitmentRendezvousRecordV1>,
    candidate_bytes: &[u8],
    command: &VerifiedTenantRootRoleCreationCommandV1,
    journal: &ValidatedTenantRootCreationJournalV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    now_ms: u64,
) -> RouterAbProtocolResult<TenantRootCreationCommitmentRendezvousEvaluationV1> {
    let candidate = decode_creation_commitment_candidate(
        candidate_bytes,
        &journal.ceremony_context,
        command.role(),
        role_keys,
    )?;
    let candidate_role = candidate.role();
    let candidate_bytes = candidate.canonical_bytes().to_vec();
    let Some(existing) = existing else {
        require_fresh_role_creation_command(command, now_ms)?;
        let rendezvous = commitment_rendezvous_record(
            journal,
            CloudflareTenantRootCreationCommitmentRendezvousStateV1::OneRoleCommitted {
                role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(candidate_role),
                signed_commitment_b64u: encode_base64url_bytes_v1(&candidate_bytes),
            },
        )?;
        return Ok(TenantRootCreationCommitmentRendezvousEvaluationV1::Commit {
            rendezvous,
            outcome: CloudflareTenantRootCreationCommitmentOutcomeV1::WaitingForPeer {
                role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(candidate_role),
            },
        });
    };

    let existing = validate_creation_commitment_rendezvous(existing, journal, role_keys)
        .map_err(stored_record_error)?;
    match existing.state {
        ValidatedTenantRootCreationCommitmentRendezvousStateV1::OneRoleCommitted {
            role,
            commitment,
        } => {
            if role == candidate_role {
                if commitment.canonical_bytes() != candidate_bytes {
                    return Err(commitment_conflict());
                }
                return Ok(TenantRootCreationCommitmentRendezvousEvaluationV1::Replay(
                    CloudflareTenantRootCreationCommitmentOutcomeV1::WaitingForPeer {
                        role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(role),
                    },
                ));
            }

            require_fresh_role_creation_command(command, now_ms)?;
            let (deriver_a, deriver_b) = match candidate_role {
                TwoPartyDeriverRole::DeriverA => (candidate, commitment),
                TwoPartyDeriverRole::DeriverB => (commitment, candidate),
            };
            let deriver_a_bytes = deriver_a.canonical_bytes().to_vec();
            let deriver_b_bytes = deriver_b.canonical_bytes().to_vec();
            let pair = VerifiedTenantRootCreationCommitmentPairV1::new(deriver_a, deriver_b)
                .map_err(candidate_derivation_error)?;
            let rendezvous = commitment_rendezvous_record(
                journal,
                CloudflareTenantRootCreationCommitmentRendezvousStateV1::BothRolesCommitted {
                    deriver_a_signed_commitment_b64u: encode_base64url_bytes_v1(&deriver_a_bytes),
                    deriver_b_signed_commitment_b64u: encode_base64url_bytes_v1(&deriver_b_bytes),
                },
            )?;
            Ok(TenantRootCreationCommitmentRendezvousEvaluationV1::Commit {
                rendezvous,
                outcome: CloudflareTenantRootCreationCommitmentOutcomeV1::BothRolesCommitted {
                    pair,
                },
            })
        }
        ValidatedTenantRootCreationCommitmentRendezvousStateV1::BothRolesCommitted { pair } => {
            let accepted = match candidate_role {
                TwoPartyDeriverRole::DeriverA => pair.deriver_a().canonical_bytes(),
                TwoPartyDeriverRole::DeriverB => pair.deriver_b().canonical_bytes(),
            };
            if accepted != candidate_bytes {
                return Err(commitment_conflict());
            }
            Ok(TenantRootCreationCommitmentRendezvousEvaluationV1::Replay(
                CloudflareTenantRootCreationCommitmentOutcomeV1::BothRolesCommitted { pair },
            ))
        }
    }
}

pub(super) fn commitment_rendezvous_record(
    journal: &ValidatedTenantRootCreationJournalV1,
    state: CloudflareTenantRootCreationCommitmentRendezvousStateV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationCommitmentRendezvousRecordV1> {
    Ok(CloudflareTenantRootCreationCommitmentRendezvousRecordV1 {
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
        state,
    })
}

pub(super) fn decode_creation_commitment_candidate(
    bytes: &[u8],
    expected_context: &TenantRootCeremonyContextV1,
    expected_role: TwoPartyDeriverRole,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootCreationCommitmentV1> {
    let signed = TenantRootSignedCreationCommitmentV1::decode_canonical_bytes(bytes)
        .map_err(candidate_derivation_error)?;
    verify_creation_commitment(signed, expected_context, expected_role, role_keys)
}

pub(super) fn validate_creation_commitment_wire(
    encoded: &str,
    expected_context: &TenantRootCeremonyContextV1,
    expected_role: TwoPartyDeriverRole,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootCreationCommitmentV1> {
    let bytes = decode_canonical_base64url(
        "tenant-root signed creation commitment",
        encoded,
        TENANT_ROOT_SIGNED_CREATION_COMMITMENT_MAX_BYTES_V1,
        TENANT_ROOT_CREATION_COMMITMENT_MAX_BASE64URL_BYTES_V1,
    )?;
    let signed = TenantRootSignedCreationCommitmentV1::decode_canonical_bytes(&bytes)
        .map_err(candidate_derivation_error)?;
    verify_creation_commitment(signed, expected_context, expected_role, role_keys)
}

pub(super) fn verify_creation_commitment(
    signed: TenantRootSignedCreationCommitmentV1,
    expected_context: &TenantRootCeremonyContextV1,
    expected_role: TwoPartyDeriverRole,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootCreationCommitmentV1> {
    let role = signed.role();
    let signing_key_id = signed.signing_key_id().to_owned();
    let verifying_key = role_keys.for_role_and_key_id(role, &signing_key_id)?;
    signed
        .verify_strict(
            expected_context,
            expected_role,
            &signing_key_id,
            verifying_key,
        )
        .map_err(candidate_authorization_error)
}

pub(super) fn commitment_conflict() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::ConflictingPair,
        "tenant-root creation commitment conflicts with the accepted rendezvous",
    )
}

pub(super) enum ValidatedTenantRootCreationInstallationStateV1 {
    OneRoleReady {
        role: TwoPartyDeriverRole,
        evidence: Box<VerifiedTenantRootSignedShareInstallationEvidenceWireV1>,
    },
    BothRolesReady {
        deriver_a: Box<VerifiedTenantRootSignedShareInstallationEvidenceWireV1>,
        deriver_b: Box<VerifiedTenantRootSignedShareInstallationEvidenceWireV1>,
        root_commitment: [u8; 32],
    },
}

pub(crate) struct ValidatedTenantRootCreationInstallationCheckpointV1 {
    pub(super) state: ValidatedTenantRootCreationInstallationStateV1,
}

pub(super) fn validate_installation_checkpoint(
    record: CloudflareTenantRootCreationInstallationCheckpointV1,
    journal: &ValidatedTenantRootCreationJournalV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    commitments: &VerifiedTenantRootCreationCommitmentPairV1,
) -> RouterAbProtocolResult<ValidatedTenantRootCreationInstallationCheckpointV1> {
    let ceremony_context_digest = journal
        .ceremony_context
        .digest()
        .map_err(candidate_derivation_error)?;
    if record.journal_digest_b64u != encode_base64url_bytes_v1(journal.journal_digest.as_bytes())
        || record.identity_digest_b64u
            != encode_base64url_bytes_v1(journal.identity_digest.as_bytes())
        || record.custody_lineage_b64u != journal.custody_lineage.to_base64url()
        || record.ceremony_context_digest_b64u
            != encode_base64url_bytes_v1(ceremony_context_digest.as_bytes())
    {
        return Err(malformed_input(
            "tenant-root creation installation checkpoint scope is invalid",
        ));
    }
    let state = match &record.state {
        CloudflareTenantRootCreationInstallationStateV1::OneRoleReady {
            role,
            signed_evidence_b64u,
        } => {
            let evidence = validate_installation_evidence_wire(
                signed_evidence_b64u,
                &journal.ceremony_context,
                role_keys,
            )?;
            if evidence.evidence().transcript().role() != role.to_protocol() {
                return Err(malformed_input(
                    "tenant-root creation installation checkpoint role is invalid",
                ));
            }
            require_installation_commitments_match(&evidence, commitments)?;
            ValidatedTenantRootCreationInstallationStateV1::OneRoleReady {
                role: role.to_protocol(),
                evidence: Box::new(evidence),
            }
        }
        CloudflareTenantRootCreationInstallationStateV1::BothRolesReady {
            deriver_a_signed_evidence_b64u,
            deriver_b_signed_evidence_b64u,
            root_commitment_b64u,
        } => {
            let deriver_a = validate_installation_evidence_wire(
                deriver_a_signed_evidence_b64u,
                &journal.ceremony_context,
                role_keys,
            )?;
            let deriver_b = validate_installation_evidence_wire(
                deriver_b_signed_evidence_b64u,
                &journal.ceremony_context,
                role_keys,
            )?;
            if deriver_a.evidence().transcript().role() != TwoPartyDeriverRole::DeriverA
                || deriver_b.evidence().transcript().role() != TwoPartyDeriverRole::DeriverB
            {
                return Err(malformed_input(
                    "tenant-root creation installation checkpoint pair roles are invalid",
                ));
            }
            require_installation_commitments_match(&deriver_a, commitments)?;
            require_installation_commitments_match(&deriver_b, commitments)?;
            let commitments =
                verify_tenant_root_creation_evidence_v1(deriver_a.evidence(), deriver_b.evidence())
                    .map_err(candidate_derivation_error)?;
            let root_commitment = commitments.root().to_bytes();
            let stored_root = decode_fixed_base64url_32(
                "tenant-root creation installation root commitment",
                root_commitment_b64u,
            )?;
            if stored_root != root_commitment {
                return Err(malformed_input(
                    "tenant-root creation installation checkpoint root commitment is invalid",
                ));
            }
            ValidatedTenantRootCreationInstallationStateV1::BothRolesReady {
                deriver_a: Box::new(deriver_a),
                deriver_b: Box::new(deriver_b),
                root_commitment,
            }
        }
    };
    Ok(ValidatedTenantRootCreationInstallationCheckpointV1 { state })
}

pub(super) fn decode_and_verify_initial_activation_receipt(
    encoded: &str,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
) -> RouterAbProtocolResult<router_ab_core::VerifiedTenantRootSignedActivationReceiptV1> {
    let bytes = decode_canonical_base64url(
        "tenant-root initial activation receipt",
        encoded,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BYTES_V1,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BASE64URL_BYTES_V1,
    )?;
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&bytes)
        .map_err(candidate_derivation_error)?;
    let issuer_key_id = receipt.issuer_key_id();
    let issuer_verifying_key = issuer_keys.get(issuer_key_id).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root initial activation receipt issuer is not trusted",
        )
    })?;
    receipt
        .verify_issuer_signature(issuer_verifying_key)
        .map_err(candidate_authorization_error)
}

pub(super) fn decode_and_verify_refresh_activation_receipt(
    encoded: &str,
    issuer_keys: &BTreeMap<String, [u8; 32]>,
) -> RouterAbProtocolResult<router_ab_core::VerifiedTenantRootSignedActivationReceiptV1> {
    let bytes = decode_canonical_base64url(
        "tenant-root refresh activation receipt",
        encoded,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BYTES_V1,
        TENANT_ROOT_REFRESH_ACTIVE_RECEIPT_MAX_BASE64URL_BYTES_V1,
    )?;
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(&bytes)
        .map_err(candidate_derivation_error)?;
    if receipt.transition() != TenantRootActivationReceiptTransitionV1::RefreshSwap {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation requires a refresh-swap receipt",
        ));
    }
    let issuer_key_id = receipt.issuer_key_id();
    let issuer_verifying_key = issuer_keys.get(issuer_key_id).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh activation receipt issuer is not trusted",
        )
    })?;
    receipt
        .verify_issuer_signature(issuer_verifying_key)
        .map_err(candidate_authorization_error)
}

pub(super) fn validate_initial_activation_receipt_against_creation_state(
    activation_receipt: &router_ab_core::VerifiedTenantRootSignedActivationReceiptV1,
    journal: &ValidatedTenantRootCreationJournalV1,
    installation: &ValidatedTenantRootCreationInstallationCheckpointV1,
) -> RouterAbProtocolResult<()> {
    if activation_receipt.transition() != TenantRootActivationReceiptTransitionV1::InitialCreation {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root initial activation requires an initial-creation receipt",
        ));
    }
    let ceremony_context_digest = journal
        .ceremony_context
        .digest()
        .map_err(candidate_derivation_error)?;
    let expected_revision = journal.revision.checked_add(1).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root creation journal revision cannot advance for activation",
        )
    })?;
    let result_revision = expected_revision.checked_add(1).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root activation result revision cannot advance",
        )
    })?;
    if activation_receipt.identity_digest() != journal.identity_digest
        || activation_receipt.custody_lineage() != journal.custody_lineage
        || activation_receipt.context_digest() != ceremony_context_digest
        || activation_receipt.expected_control_plane_revision() != expected_revision
        || activation_receipt.result_control_plane_revision() != result_revision
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root initial activation receipt does not match the creation journal",
        ));
    }

    let ValidatedTenantRootCreationInstallationStateV1::BothRolesReady {
        deriver_a,
        deriver_b,
        root_commitment,
    } = &installation.state
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root initial activation requires BothRolesReady installation state",
        ));
    };
    let verified_pair =
        verify_tenant_root_creation_evidence_v1(deriver_a.evidence(), deriver_b.evidence())
            .map_err(candidate_derivation_error)?;
    let commitments = TenantRootEpochCommitmentsV1::from_verified(verified_pair)
        .map_err(candidate_derivation_error)?;
    let installation_receipts = TenantRootRoleInstallationReceiptsV1::new(
        deriver_a
            .lifecycle_receipt_digest()
            .map_err(candidate_derivation_error)?,
        deriver_b
            .lifecycle_receipt_digest()
            .map_err(candidate_derivation_error)?,
    )
    .map_err(candidate_derivation_error)?;
    if commitments.root_commitment() != root_commitment {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root initial activation installation root commitment is invalid",
        ));
    }
    let TenantRootActivationReceiptBindingV1::InitialCreation(receipt_binding) =
        activation_receipt.binding()
    else {
        unreachable!("initial activation transition selects the initial binding");
    };
    if receipt_binding.commitments() != &commitments
        || receipt_binding.installation_receipts() != installation_receipts
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root initial activation receipt does not match the installation checkpoint",
        ));
    }
    Ok(())
}

pub(super) fn evaluate_installation_checkpoint(
    existing: Option<CloudflareTenantRootCreationInstallationCheckpointV1>,
    candidate: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    command: &VerifiedTenantRootRoleCreationCommandV1,
    journal: &ValidatedTenantRootCreationJournalV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    commitments: &VerifiedTenantRootCreationCommitmentPairV1,
    now_ms: u64,
) -> RouterAbProtocolResult<TenantRootCreationInstallationEvaluationV1> {
    let candidate = validate_installation_evidence_wire(
        &encode_base64url_bytes_v1(candidate.canonical_bytes()),
        &journal.ceremony_context,
        role_keys,
    )?;
    require_installation_commitments_match(&candidate, commitments)?;
    let candidate_role = candidate.evidence().transcript().role();
    if candidate_role != command.role() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root installation evidence role does not match its role creation command",
        ));
    }
    let candidate_bytes = candidate.canonical_bytes().to_vec();
    let Some(existing) = existing else {
        require_fresh_role_creation_command(command, now_ms)?;
        let checkpoint = installation_checkpoint_record(
            journal,
            CloudflareTenantRootCreationInstallationStateV1::OneRoleReady {
                role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(candidate_role),
                signed_evidence_b64u: encode_base64url_bytes_v1(&candidate_bytes),
            },
        )?;
        return Ok(TenantRootCreationInstallationEvaluationV1::Commit {
            checkpoint,
            outcome: CloudflareTenantRootCreationInstallationOutcomeV1::WaitingForPeer {
                role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(candidate_role),
            },
        });
    };
    let existing = validate_installation_checkpoint(existing, journal, role_keys, commitments)
        .map_err(stored_record_error)?;
    match existing.state {
        ValidatedTenantRootCreationInstallationStateV1::OneRoleReady { role, evidence } => {
            if role == candidate_role {
                if evidence.canonical_bytes() != candidate_bytes {
                    return Err(installation_conflict());
                }
                return Ok(TenantRootCreationInstallationEvaluationV1::Replay(
                    CloudflareTenantRootCreationInstallationOutcomeV1::WaitingForPeer {
                        role: CloudflareTenantRootCreationInstallationRoleV1::from_protocol(role),
                    },
                ));
            }
            require_fresh_role_creation_command(command, now_ms)?;
            let (deriver_a, deriver_b) = match candidate_role {
                TwoPartyDeriverRole::DeriverA => (candidate, *evidence),
                TwoPartyDeriverRole::DeriverB => (*evidence, candidate),
            };
            let commitments =
                verify_tenant_root_creation_evidence_v1(deriver_a.evidence(), deriver_b.evidence())
                    .map_err(candidate_derivation_error)?;
            let root_commitment = commitments.root().to_bytes();
            let checkpoint = installation_checkpoint_record(
                journal,
                CloudflareTenantRootCreationInstallationStateV1::BothRolesReady {
                    deriver_a_signed_evidence_b64u: encode_base64url_bytes_v1(
                        deriver_a.canonical_bytes(),
                    ),
                    deriver_b_signed_evidence_b64u: encode_base64url_bytes_v1(
                        deriver_b.canonical_bytes(),
                    ),
                    root_commitment_b64u: encode_base64url_bytes_v1(&root_commitment),
                },
            )?;
            Ok(TenantRootCreationInstallationEvaluationV1::Commit {
                checkpoint,
                outcome: CloudflareTenantRootCreationInstallationOutcomeV1::BothRolesReady {
                    root_commitment_b64u: encode_base64url_bytes_v1(&root_commitment),
                },
            })
        }
        ValidatedTenantRootCreationInstallationStateV1::BothRolesReady {
            deriver_a,
            deriver_b,
            root_commitment,
        } => {
            let accepted = match candidate_role {
                TwoPartyDeriverRole::DeriverA => deriver_a.canonical_bytes(),
                TwoPartyDeriverRole::DeriverB => deriver_b.canonical_bytes(),
            };
            if accepted != candidate_bytes {
                return Err(installation_conflict());
            }
            Ok(TenantRootCreationInstallationEvaluationV1::Replay(
                CloudflareTenantRootCreationInstallationOutcomeV1::BothRolesReady {
                    root_commitment_b64u: encode_base64url_bytes_v1(&root_commitment),
                },
            ))
        }
    }
}

pub(super) fn installation_checkpoint_record(
    journal: &ValidatedTenantRootCreationJournalV1,
    state: CloudflareTenantRootCreationInstallationStateV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationInstallationCheckpointV1> {
    Ok(CloudflareTenantRootCreationInstallationCheckpointV1 {
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
        state,
    })
}

/// The exact material an abandoned role's cleanup removes. A role the fence
/// recorded as installed is bound to its recorded installation evidence. Any
/// other role is bound to the abandoned ceremony alone, which covers a share
/// it wrote without checkpointing and one a command admitted before the fence
/// finishes writing afterwards.
pub(super) fn creation_cleanup_target(
    journal: &ValidatedTenantRootCreationJournalV1,
    abandonment: &CloudflareTenantRootCreationAbandonmentV1,
    installation: Option<&ValidatedTenantRootCreationInstallationCheckpointV1>,
    cleaned: CloudflareTenantRootCreationInstallationRoleV1,
) -> RouterAbProtocolResult<(
    TenantRootRoleCleanupTargetV1,
    CloudflareTenantRootCreationInstallationRoleV1,
)> {
    let role = &cleaned.to_protocol();
    if !abandonment.installed_roles.contains(&cleaned) {
        return Ok((
            TenantRootRoleCleanupTargetV1::AbandonedCeremony {
                identity_digest: journal.identity_digest,
                custody_lineage: journal.custody_lineage,
                role: *role,
                session_id: journal.ceremony_context.session_id(),
                ceremony_nonce: journal.ceremony_context.nonce(),
            },
            cleaned,
        ));
    }
    let installation = installation.ok_or_else(|| {
        malformed_input("tenant-root creation abandonment recorded a role with no installation")
    })?;
    let evidence = match &installation.state {
        ValidatedTenantRootCreationInstallationStateV1::OneRoleReady {
            role: installed,
            evidence,
        } if installed == role => evidence,
        ValidatedTenantRootCreationInstallationStateV1::BothRolesReady { deriver_a, .. }
            if *role == TwoPartyDeriverRole::DeriverA =>
        {
            deriver_a
        }
        ValidatedTenantRootCreationInstallationStateV1::BothRolesReady { deriver_b, .. }
            if *role == TwoPartyDeriverRole::DeriverB =>
        {
            deriver_b
        }
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "tenant-root creation cleanup names a role that did not install",
            ))
        }
    };
    let evidence_digest = evidence
        .lifecycle_receipt_digest()
        .map_err(candidate_derivation_error)?;
    Ok((
        TenantRootRoleCleanupTargetV1::Pending {
            identity_digest: journal.identity_digest,
            custody_lineage: journal.custody_lineage,
            role: *role,
            epoch: TenantRootShareEpoch::INITIAL,
            expected_row_revision: 1,
            session_id: journal.ceremony_context.session_id(),
            ceremony_nonce: journal.ceremony_context.nonce(),
            installation_evidence_digest: TenantRootProtocolDigestV1::from_bytes(
                *evidence_digest.as_bytes(),
            )
            .map_err(candidate_derivation_error)?,
        },
        CloudflareTenantRootCreationInstallationRoleV1::from_protocol(*role),
    ))
}

pub(super) fn validate_creation_cleanup_checkpoint(
    record: CloudflareTenantRootCreationCleanupCheckpointV1,
    journal: &ValidatedTenantRootCreationJournalV1,
    abandonment: &CloudflareTenantRootCreationAbandonmentV1,
    installation: Option<&ValidatedTenantRootCreationInstallationCheckpointV1>,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_verifying_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<ValidatedTenantRootCreationCleanupCheckpointV1> {
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
            "tenant-root creation cleanup checkpoint scope is invalid",
        ));
    }
    let (target, role) = creation_cleanup_target(journal, abandonment, installation, record.role)?;
    if record.role != role {
        return Err(malformed_input(
            "tenant-root creation cleanup checkpoint role is invalid",
        ));
    }
    let cleanup_command_bytes = decode_canonical_base64url(
        "tenant-root creation cleanup command",
        &record.cleanup_command_b64u,
        TENANT_ROOT_ROLE_CLEANUP_COMMAND_MAX_BYTES_V1,
        TENANT_ROOT_ROLE_CLEANUP_COMMAND_MAX_BASE64URL_BYTES_V1,
    )?;
    let cleanup_command =
        TenantRootRoleCleanupCommandV1::decode_canonical_bytes(&cleanup_command_bytes)
            .map_err(candidate_derivation_error)?;
    let issuer_key_id = cleanup_command.issuer_key_id();
    let issuer_key = trusted_issuer_verifying_keys
        .get(issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root creation cleanup issuer is not trusted",
            )
        })?;
    let authorization = cleanup_command
        .verify(
            &target,
            target.role(),
            authority_id,
            issuer_key_id,
            issuer_key,
        )
        .map_err(candidate_authorization_error)?;
    let authorization_bytes = authorization
        .canonical_bytes()
        .map_err(candidate_derivation_error)?;
    if authorization_bytes != cleanup_command_bytes {
        return Err(malformed_input(
            "tenant-root creation cleanup authorization bytes changed during verification",
        ));
    }
    let cleanup_receipt_bytes = decode_canonical_base64url(
        "tenant-root creation cleanup receipt",
        &record.cleanup_receipt_b64u,
        TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BYTES_V1,
        TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BASE64URL_BYTES_V1,
    )?;
    let cleanup_receipt =
        TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&cleanup_receipt_bytes)
            .map_err(candidate_derivation_error)?;
    let TenantRootCommandTerminalReceiptV1::Success(cleanup_receipt) = cleanup_receipt else {
        return Err(malformed_input(
            "tenant-root creation cleanup requires a successful terminal receipt",
        ));
    };
    let cleanup_nonce = authorization.nonce();
    let replay_session = TenantRootCeremonySessionIdV1::from_bytes(
        cleanup_nonce.as_bytes()[..16]
            .try_into()
            .expect("sixteen cleanup nonce bytes"),
    )
    .map_err(candidate_derivation_error)?;
    let replay_key = TenantRootCommandReplayKeyV1::new(
        journal.identity_digest,
        journal.custody_lineage,
        replay_session,
        cleanup_nonce,
        target.role(),
    );
    let role_signing_key_id = journal.ceremony_context.signing_key_id(target.role());
    let role_verifying_key = role_keys.for_role_and_key_id(target.role(), role_signing_key_id)?;
    cleanup_receipt
        .verify_remote_public(
            &replay_key,
            &authorization_bytes,
            authorization.issued_at_ms(),
            role_signing_key_id,
            role_verifying_key,
        )
        .map_err(candidate_authorization_error)?;
    let receipt_digest = cleanup_receipt
        .digest()
        .map_err(candidate_derivation_error)?;
    if record.cleanup_receipt_digest_b64u != encode_base64url_bytes_v1(receipt_digest.as_bytes()) {
        return Err(malformed_input(
            "tenant-root creation cleanup receipt digest does not match its bytes",
        ));
    }
    Ok(ValidatedTenantRootCreationCleanupCheckpointV1 {
        record,
        authorization,
        receipt_digest,
    })
}

pub(super) fn creation_cleanup_checkpoint_record(
    request: CloudflareTenantRootCreationCleanupRequestV1,
    journal: &ValidatedTenantRootCreationJournalV1,
    role: CloudflareTenantRootCreationInstallationRoleV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationCleanupCheckpointV1> {
    let receipt_bytes = decode_canonical_base64url(
        "tenant-root creation cleanup receipt",
        &request.cleanup_receipt_b64u,
        TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BYTES_V1,
        TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BASE64URL_BYTES_V1,
    )?;
    let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .map_err(candidate_derivation_error)?;
    Ok(CloudflareTenantRootCreationCleanupCheckpointV1 {
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
        role,
        cleanup_command_b64u: request.cleanup_command_b64u,
        cleanup_receipt_b64u: request.cleanup_receipt_b64u,
        cleanup_receipt_digest_b64u: encode_base64url_bytes_v1(
            receipt
                .digest()
                .map_err(candidate_derivation_error)?
                .as_bytes(),
        ),
    })
}

pub(super) fn creation_cleanup_response(
    outcome: CloudflareTenantRootCreationCleanupOutcomeV1,
    validated: &ValidatedTenantRootCreationCleanupCheckpointV1,
) -> CloudflareTenantRootCreationCleanupResponseV1 {
    CloudflareTenantRootCreationCleanupResponseV1 {
        outcome,
        role: validated.record.role,
        cleanup_receipt_digest_b64u: encode_base64url_bytes_v1(validated.receipt_digest.as_bytes()),
    }
}

pub(super) fn evaluate_creation_cleanup_checkpoint(
    existing: Option<CloudflareTenantRootCreationCleanupCheckpointV1>,
    candidate: ValidatedTenantRootCreationCleanupCheckpointV1,
    journal: &ValidatedTenantRootCreationJournalV1,
    abandonment: &CloudflareTenantRootCreationAbandonmentV1,
    installation: Option<&ValidatedTenantRootCreationInstallationCheckpointV1>,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_verifying_keys: &BTreeMap<String, [u8; 32]>,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    now_ms: u64,
) -> RouterAbProtocolResult<TenantRootCreationCleanupEvaluationV1> {
    let Some(existing) = existing else {
        candidate
            .authorization
            .require_fresh(now_ms)
            .map_err(candidate_authorization_error)?;
        let response = creation_cleanup_response(
            CloudflareTenantRootCreationCleanupOutcomeV1::Committed,
            &candidate,
        );
        return Ok(TenantRootCreationCleanupEvaluationV1::Commit {
            checkpoint: candidate.record,
            response,
        });
    };
    let existing = validate_creation_cleanup_checkpoint(
        existing,
        journal,
        abandonment,
        installation,
        authority_id,
        trusted_issuer_verifying_keys,
        role_keys,
    )
    .map_err(stored_record_error)?;
    if existing.record != candidate.record {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root creation cleanup conflicts with the accepted cleanup",
        ));
    }
    Ok(TenantRootCreationCleanupEvaluationV1::Replay(
        creation_cleanup_response(
            CloudflareTenantRootCreationCleanupOutcomeV1::Replay,
            &existing,
        ),
    ))
}

pub(super) fn validate_installation_evidence_wire(
    encoded: &str,
    expected_context: &TenantRootCeremonyContextV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootSignedShareInstallationEvidenceWireV1> {
    let bytes = decode_canonical_base64url(
        "tenant-root signed installation evidence",
        encoded,
        TENANT_ROOT_SIGNED_SHARE_INSTALLATION_EVIDENCE_MAX_BYTES_V1,
        TENANT_ROOT_CREATION_INSTALLATION_EVIDENCE_MAX_BASE64URL_BYTES_V1,
    )?;
    let decoded = TenantRootSignedShareInstallationEvidenceV1::decode_canonical_bytes(&bytes)
        .map_err(candidate_derivation_error)?;
    let role = decoded.role();
    let verifying_key = role_keys.for_role_and_key_id(role, decoded.signing_key_id())?;
    let verified = TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        &bytes,
        verifying_key,
    )
    .map_err(candidate_authorization_error)?;
    if verified.evidence().transcript().context() != expected_context {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root installation evidence does not match the Started ceremony",
        ));
    }
    Ok(verified)
}

pub(super) fn require_installation_commitments_match(
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    commitments: &VerifiedTenantRootCreationCommitmentPairV1,
) -> RouterAbProtocolResult<()> {
    let transcript = evidence.evidence().transcript();
    let (expected_commitment, expected_peer_commitment) = match transcript.role() {
        TwoPartyDeriverRole::DeriverA => (
            commitments.deriver_a().commitment(),
            commitments.deriver_b().commitment(),
        ),
        TwoPartyDeriverRole::DeriverB => (
            commitments.deriver_b().commitment(),
            commitments.deriver_a().commitment(),
        ),
    };
    if transcript.commitment() != expected_commitment
        || transcript.peer_commitment() != expected_peer_commitment
    {
        return Err(installation_conflict());
    }
    Ok(())
}

pub(super) fn decode_fixed_base64url_32(field: &str, encoded: &str) -> RouterAbProtocolResult<[u8; 32]> {
    decode_canonical_base64url(field, encoded, 32, base64url_len_for_bytes(32))?
        .try_into()
        .map_err(|_| malformed_input(format!("{field} must contain exactly 32 bytes")))
}

pub(super) fn installation_conflict() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::ConflictingPair,
        "tenant-root creation installation evidence conflicts with the accepted checkpoint",
    )
}

pub(super) struct CreationResponseScopeV1 {
    pub(super) command_digest_b64u: String,
    pub(super) journal_digest_b64u: String,
    pub(super) identity_digest_b64u: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) ceremony_context_digest_b64u: String,
}

pub(super) fn creation_response_scope(
    command: &VerifiedTenantRootRoleCreationCommandV1,
    journal: &ValidatedTenantRootCreationJournalV1,
) -> RouterAbProtocolResult<CreationResponseScopeV1> {
    Ok(CreationResponseScopeV1 {
        command_digest_b64u: encode_base64url_bytes_v1(command.digest().as_bytes()),
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
    })
}

pub(super) fn commitment_response(
    scope: CreationResponseScopeV1,
    candidate_bytes: &[u8],
    outcome: CloudflareTenantRootCreationCommitmentOutcomeV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationCommitmentResponseV1> {
    let outcome = match outcome {
        CloudflareTenantRootCreationCommitmentOutcomeV1::WaitingForPeer { role } => {
            CloudflareTenantRootCreationCommitmentResponseOutcomeV1::WaitingForPeer {
                role,
                signed_commitment_b64u: encode_base64url_bytes_v1(candidate_bytes),
            }
        }
        CloudflareTenantRootCreationCommitmentOutcomeV1::BothRolesCommitted { pair } => {
            CloudflareTenantRootCreationCommitmentResponseOutcomeV1::BothRolesCommitted {
                deriver_a_signed_commitment_b64u: encode_base64url_bytes_v1(
                    pair.deriver_a().canonical_bytes(),
                ),
                deriver_b_signed_commitment_b64u: encode_base64url_bytes_v1(
                    pair.deriver_b().canonical_bytes(),
                ),
                pair_digest_b64u: encode_base64url_bytes_v1(pair.digest().as_bytes()),
            }
        }
    };
    Ok(CloudflareTenantRootCreationCommitmentResponseV1 {
        outcome,
        command_digest_b64u: scope.command_digest_b64u,
        journal_digest_b64u: scope.journal_digest_b64u,
        identity_digest_b64u: scope.identity_digest_b64u,
        custody_lineage_b64u: scope.custody_lineage_b64u,
        ceremony_context_digest_b64u: scope.ceremony_context_digest_b64u,
    })
}

pub(super) fn installation_response(
    scope: CreationResponseScopeV1,
    outcome: CloudflareTenantRootCreationInstallationOutcomeV1,
) -> RouterAbProtocolResult<CloudflareTenantRootCreationInstallationResponseV1> {
    let outcome = match outcome {
        CloudflareTenantRootCreationInstallationOutcomeV1::WaitingForPeer { role } => {
            CloudflareTenantRootCreationInstallationResponseOutcomeV1::WaitingForPeer { role }
        }
        CloudflareTenantRootCreationInstallationOutcomeV1::BothRolesReady {
            root_commitment_b64u,
        } => CloudflareTenantRootCreationInstallationResponseOutcomeV1::BothRolesReady {
            root_commitment_b64u,
        },
    };
    Ok(CloudflareTenantRootCreationInstallationResponseV1 {
        outcome,
        command_digest_b64u: scope.command_digest_b64u,
        journal_digest_b64u: scope.journal_digest_b64u,
        identity_digest_b64u: scope.identity_digest_b64u,
        custody_lineage_b64u: scope.custody_lineage_b64u,
        ceremony_context_digest_b64u: scope.ceremony_context_digest_b64u,
    })
}
