//! Command replay, refresh durable state and artifacts, creation and refresh inputs, command decisions and terminal commits.

use super::*;

#[derive(Debug, Deserialize)]
pub(super) struct TenantRootCommandReplayD1RowV1 {
    pub(super) replay_key_digest_hex: String,
    pub(super) tenant_identity_digest_hex: String,
    pub(super) custody_lineage_b64u: String,
    pub(super) session_id_hex: String,
    pub(super) nonce_hex: String,
    pub(super) role: String,
    pub(super) command_digest_hex: String,
    pub(super) admission_digest_hex: Option<String>,
    pub(super) status: String,
    pub(super) receipt_b64u: Option<String>,
    pub(super) receipt_digest_hex: Option<String>,
    pub(super) reserved_at_ms: i64,
    pub(super) executed_at_ms: Option<i64>,
    pub(super) terminal_at_ms: Option<i64>,
    pub(super) refresh_state_b64u: Option<String>,
    pub(super) refresh_state_digest_hex: Option<String>,
}

pub(super) struct StoredTenantRootCommandReplayV1 {
    pub(super) record: TenantRootCommandReplayRecordV1,
    pub(super) admission_digest: Option<TenantRootProtocolDigestV1>,
    pub(super) refresh_state: Option<CloudflareTenantRootRefreshDurableStateV1>,
    pub(super) receipt_bytes: Option<Vec<u8>>,
    pub(super) reserved_at_ms: u64,
    pub(super) executed_at_ms: Option<u64>,
}

/// Durable refresh state retained beside the generic command replay row.
///
/// The command and evidence bytes are retained as canonical wire bytes. They
/// let a restarted worker recover the exact provider inputs that preceded any
/// R2 operation without regenerating role material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "state",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub(crate) enum CloudflareTenantRootRefreshDurableStateV1 {
    Admitted {
        command_b64u: String,
        encrypted_seed_b64u: String,
    },
    Executed {
        command_b64u: String,
        evidence_b64u: String,
        prepared_artifacts: CloudflareTenantRootRefreshPreparedArtifactsV1,
    },
    Artifacts {
        command_b64u: String,
        evidence_b64u: String,
        prepared_artifacts: CloudflareTenantRootRefreshPreparedArtifactsV1,
        artifacts: CloudflareTenantRootRefreshArtifactMetadataV1,
    },
}

/// An older attempt of a refresh's epoch transition that the refresh
/// supersedes, as loaded. The batch records it only while its replay row still
/// holds exactly this state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CloudflareTenantRootSupersededRefreshAttemptV1 {
    pub(super) replay_key_digest_hex: String,
    pub(super) status: String,
    pub(super) refresh_state_digest_hex: String,
}

/// What a refresh's pending checkpoint replaces at this Deriver: the older
/// attempts of its epoch transition, and the pending row one of them left at
/// the next epoch.
///
/// It is loaded before the Router confirms the refresh as its current attempt.
/// The Router keeps one live attempt per root and abandons an attempt before
/// reserving the next, so every attempt admitted here before that confirmation
/// is one the Router has already abandoned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRefreshSupersessionV1 {
    pub(super) superseded: Vec<CloudflareTenantRootSupersededRefreshAttemptV1>,
    pub(super) pending_row_revision: Option<i64>,
}

/// Exact canonical artifacts prepared before the pending role row is written.
///
/// These bytes are the replay source after a crash. R2 writes therefore never
/// require rerunning provider randomness or re-signing an artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshPreparedArtifactsV1 {
    pub(super) managed_backup_b64u: String,
    pub(super) provider_canary_receipt_b64u: String,
}

impl CloudflareTenantRootRefreshPreparedArtifactsV1 {
    pub(crate) fn new(
        managed_backup: &VerifiedTenantRootManagedBackupV1,
        provider_canary: &TenantRootSignedProviderCanaryReceiptV1,
    ) -> RoleStoreResult<Self> {
        let managed_backup_bytes = managed_backup.canonical_bytes();
        let provider_canary_bytes = provider_canary
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?;
        let prepared = Self {
            managed_backup_b64u: encode_base64url_bytes_v1(managed_backup_bytes),
            provider_canary_receipt_b64u: encode_base64url_bytes_v1(&provider_canary_bytes),
        };
        prepared.validate()?;
        Ok(prepared)
    }

    pub(crate) fn managed_backup_bytes(&self) -> RoleStoreResult<Vec<u8>> {
        decode_prepared_refresh_artifact(
            "tenant-root refresh managed-backup artifact",
            &self.managed_backup_b64u,
            MAX_REFRESH_PREPARED_MANAGED_BACKUP_BYTES,
        )
    }

    pub(crate) fn provider_canary_receipt_bytes(&self) -> RoleStoreResult<Vec<u8>> {
        decode_prepared_refresh_artifact(
            "tenant-root refresh provider-canary artifact",
            &self.provider_canary_receipt_b64u,
            MAX_REFRESH_PREPARED_CANARY_BYTES,
        )
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        let managed_backup_bytes = self.managed_backup_bytes()?;
        let managed_backup =
            TenantRootSignedManagedBackupV1::decode_canonical_bytes(&managed_backup_bytes)
                .map_err(|error| store_error(error.message()))?;
        if managed_backup
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?
            != managed_backup_bytes
        {
            return Err(store_error(
                "tenant-root refresh managed-backup artifact is not canonical",
            ));
        }
        let provider_canary_bytes = self.provider_canary_receipt_bytes()?;
        let provider_canary =
            TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(&provider_canary_bytes)
                .map_err(|error| store_error(error.message()))?;
        if provider_canary
            .canonical_bytes()
            .map_err(|error| store_error(error.message()))?
            != provider_canary_bytes
        {
            return Err(store_error(
                "tenant-root refresh provider-canary artifact is not canonical",
            ));
        }
        Ok(())
    }
}

/// Exact immutable artifacts bound to a terminal refresh replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct CloudflareTenantRootRefreshArtifactMetadataV1 {
    pub(super) backup_object_key: String,
    pub(super) backup_artifact_digest_hex: String,
    pub(super) backup_object_generation: String,
    pub(super) backup_key_generation_ref: String,
    pub(super) canary_object_key: String,
    pub(super) canary_artifact_digest_hex: String,
    pub(super) canary_object_generation: String,
    pub(super) canary_key_generation_ref: String,
    pub(super) online_epoch_wrapping_key_ref: String,
    pub(super) role_signing_key_id: String,
}

impl CloudflareTenantRootRefreshDurableStateV1 {
    pub(crate) fn admitted(
        command: &VerifiedTenantRootRoleRefreshCommandV1,
        encrypted_seed_b64u: String,
    ) -> RoleStoreResult<Self> {
        let command_b64u = encode_base64url_bytes_v1(command.canonical_bytes());
        let state = Self::Admitted {
            command_b64u,
            encrypted_seed_b64u,
        };
        state.validate()?;
        Ok(state)
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        let (command_b64u, evidence_b64u) = match self {
            Self::Admitted { command_b64u, .. } => (command_b64u, None),
            Self::Executed {
                command_b64u,
                evidence_b64u,
                ..
            }
            | Self::Artifacts {
                command_b64u,
                evidence_b64u,
                ..
            } => (command_b64u, Some(evidence_b64u)),
        };
        validate_refresh_state_bytes(
            "tenant-root refresh durable command",
            command_b64u,
            TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BYTES_V1,
        )?;
        if let Some(evidence_b64u) = evidence_b64u {
            validate_refresh_state_bytes(
                "tenant-root refresh durable evidence",
                evidence_b64u,
                TENANT_ROOT_ROLE_REFRESH_COMMAND_MAX_BYTES_V1,
            )?;
        }
        match self {
            Self::Admitted {
                encrypted_seed_b64u,
                ..
            } => {
                let bytes = decode_base64url_bytes_v1("refresh replay seed", encrypted_seed_b64u)
                    .map_err(|error| store_error(error.message()))?;
                if bytes.len() != CloudflareHpkeKemV1::ENCAPPED_KEY_LEN + 32 + 16 {
                    return Err(store_error("invalid encrypted refresh replay seed"));
                }
            }
            Self::Executed {
                prepared_artifacts, ..
            }
            | Self::Artifacts {
                prepared_artifacts, ..
            } => {
                prepared_artifacts.validate()?;
            }
        }
        if let Self::Artifacts { artifacts, .. } = self {
            artifacts.validate()?;
        }
        Ok(())
    }

    pub(crate) fn command_bytes(&self) -> RoleStoreResult<Vec<u8>> {
        let encoded = match self {
            Self::Admitted { command_b64u, .. }
            | Self::Executed { command_b64u, .. }
            | Self::Artifacts { command_b64u, .. } => command_b64u,
        };
        decode_refresh_state_bytes("tenant-root refresh durable command", encoded)
    }

    pub(crate) fn evidence_bytes(&self) -> RoleStoreResult<Vec<u8>> {
        let encoded = match self {
            Self::Admitted { .. } => {
                return Err(store_error(
                    "tenant-root refresh admission has no installation evidence",
                ));
            }
            Self::Executed { evidence_b64u, .. } | Self::Artifacts { evidence_b64u, .. } => {
                evidence_b64u
            }
        };
        decode_refresh_state_bytes("tenant-root refresh durable evidence", encoded)
    }

    pub(crate) fn prepared_artifacts(
        &self,
    ) -> RoleStoreResult<&CloudflareTenantRootRefreshPreparedArtifactsV1> {
        match self {
            Self::Executed {
                prepared_artifacts, ..
            }
            | Self::Artifacts {
                prepared_artifacts, ..
            } => Ok(prepared_artifacts),
            Self::Admitted { .. } => Err(store_error(
                "tenant-root refresh admission has no prepared artifacts",
            )),
        }
    }

    pub(crate) fn artifacts(
        &self,
    ) -> RoleStoreResult<&CloudflareTenantRootRefreshArtifactMetadataV1> {
        match self {
            Self::Artifacts { artifacts, .. } => Ok(artifacts),
            Self::Admitted { .. } | Self::Executed { .. } => Err(store_error(
                "tenant-root refresh durable state has no persisted artifact metadata",
            )),
        }
    }

    pub(super) fn encode(&self) -> RoleStoreResult<(String, String)> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|error| {
            store_error(format!(
                "tenant-root refresh durable state encode failed: {error}"
            ))
        })?;
        if bytes.is_empty() || bytes.len() > MAX_REFRESH_DURABLE_STATE_BYTES {
            return Err(store_error(
                "tenant-root refresh durable state exceeds its size limit",
            ));
        }
        let digest: [u8; 32] = Sha256::digest(&bytes).into();
        Ok((encode_base64url_bytes_v1(&bytes), encode_hex(&digest)))
    }

    pub(super) fn kind_matches_status(&self, status: &str) -> bool {
        match (status, self) {
            ("reserved", Self::Admitted { .. })
            | ("executed", Self::Executed { .. })
            | ("executed", Self::Artifacts { .. })
            | ("completed", Self::Artifacts { .. }) => true,
            _ => false,
        }
    }
}

impl CloudflareTenantRootRefreshArtifactMetadataV1 {
    pub(crate) fn new(
        backup: &TenantRootManagedBackupObjectMetadataV1,
        canary: &TenantRootManagedBackupObjectMetadataV1,
        online_epoch_wrapping_key_ref: impl Into<String>,
        role_signing_key_id: impl Into<String>,
    ) -> RoleStoreResult<Self> {
        let metadata = Self {
            backup_object_key: backup.object_key().to_owned(),
            backup_artifact_digest_hex: encode_hex(backup.canonical_digest()),
            backup_object_generation: backup.object_generation().to_owned(),
            backup_key_generation_ref: backup.wrapping_key_generation_ref().to_owned(),
            canary_object_key: canary.object_key().to_owned(),
            canary_artifact_digest_hex: encode_hex(canary.canonical_digest()),
            canary_object_generation: canary.object_generation().to_owned(),
            canary_key_generation_ref: canary.wrapping_key_generation_ref().to_owned(),
            online_epoch_wrapping_key_ref: online_epoch_wrapping_key_ref.into(),
            role_signing_key_id: role_signing_key_id.into(),
        };
        metadata.validate()?;
        Ok(metadata)
    }

    pub(crate) fn backup_object_key(&self) -> &str {
        &self.backup_object_key
    }

    pub(crate) fn backup_artifact_digest(&self) -> RoleStoreResult<[u8; 32]> {
        decode_lower_hex_fixed(
            "tenant-root refresh backup artifact digest",
            &self.backup_artifact_digest_hex,
        )
    }

    pub(crate) fn backup_object_generation(&self) -> &str {
        &self.backup_object_generation
    }

    pub(crate) fn backup_key_generation_ref(&self) -> &str {
        &self.backup_key_generation_ref
    }

    pub(crate) fn canary_object_key(&self) -> &str {
        &self.canary_object_key
    }

    pub(crate) fn canary_artifact_digest(&self) -> RoleStoreResult<[u8; 32]> {
        decode_lower_hex_fixed(
            "tenant-root refresh canary artifact digest",
            &self.canary_artifact_digest_hex,
        )
    }

    pub(crate) fn canary_object_generation(&self) -> &str {
        &self.canary_object_generation
    }

    pub(crate) fn canary_key_generation_ref(&self) -> &str {
        &self.canary_key_generation_ref
    }

    pub(crate) fn online_epoch_wrapping_key_ref(&self) -> &str {
        &self.online_epoch_wrapping_key_ref
    }

    pub(crate) fn role_signing_key_id(&self) -> &str {
        &self.role_signing_key_id
    }

    pub(super) fn validate(&self) -> RoleStoreResult<()> {
        require_identifier(
            "tenant-root refresh backup object key",
            &self.backup_object_key,
        )?;
        require_digest_hex(
            "tenant-root refresh backup artifact digest",
            &self.backup_artifact_digest_hex,
        )?;
        require_identifier(
            "tenant-root refresh backup object generation",
            &self.backup_object_generation,
        )?;
        require_identifier(
            "tenant-root refresh backup key generation",
            &self.backup_key_generation_ref,
        )?;
        require_identifier(
            "tenant-root refresh canary object key",
            &self.canary_object_key,
        )?;
        require_digest_hex(
            "tenant-root refresh canary artifact digest",
            &self.canary_artifact_digest_hex,
        )?;
        require_identifier(
            "tenant-root refresh canary object generation",
            &self.canary_object_generation,
        )?;
        require_identifier(
            "tenant-root refresh canary key generation",
            &self.canary_key_generation_ref,
        )?;
        require_identifier(
            "tenant-root refresh online wrapping-key generation",
            &self.online_epoch_wrapping_key_ref,
        )?;
        require_identifier(
            "tenant-root refresh role signing key",
            &self.role_signing_key_id,
        )
    }
}

/// Exact immutable artifacts recovered from a completed refresh replay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRefreshArtifactCheckpointV1 {
    pub(super) command_bytes: Vec<u8>,
    pub(super) evidence_bytes: Vec<u8>,
    pub(super) prepared_artifacts: CloudflareTenantRootRefreshPreparedArtifactsV1,
    pub(super) artifacts: CloudflareTenantRootRefreshArtifactMetadataV1,
}

impl CloudflareTenantRootRefreshArtifactCheckpointV1 {
    pub(crate) fn command_bytes(&self) -> &[u8] {
        &self.command_bytes
    }

    pub(crate) fn evidence_bytes(&self) -> &[u8] {
        &self.evidence_bytes
    }

    pub(crate) const fn prepared_artifacts(
        &self,
    ) -> &CloudflareTenantRootRefreshPreparedArtifactsV1 {
        &self.prepared_artifacts
    }

    pub(crate) const fn artifacts(&self) -> &CloudflareTenantRootRefreshArtifactMetadataV1 {
        &self.artifacts
    }
}

pub(super) fn validate_refresh_state_bytes(
    field: &str,
    encoded: &str,
    max_bytes: usize,
) -> RoleStoreResult<()> {
    let bytes = decode_refresh_state_bytes(field, encoded)?;
    if bytes.is_empty() || bytes.len() > max_bytes || encode_base64url_bytes_v1(&bytes) != encoded {
        return Err(store_error(format!("{field} is not canonical")));
    }
    Ok(())
}

pub(super) fn decode_refresh_state_bytes(field: &str, encoded: &str) -> RoleStoreResult<Vec<u8>> {
    decode_base64url_bytes_v1(field, encoded).map_err(|error| store_error(error.message()))
}

pub(super) fn decode_prepared_refresh_artifact(
    field: &str,
    encoded: &str,
    max_bytes: usize,
) -> RoleStoreResult<Vec<u8>> {
    let bytes = decode_refresh_state_bytes(field, encoded)?;
    if bytes.is_empty() || bytes.len() > max_bytes || encode_base64url_bytes_v1(&bytes) != encoded {
        return Err(store_error(format!("{field} is not canonical")));
    }
    Ok(bytes)
}

pub(super) fn decode_refresh_durable_state(
    state_b64u: &str,
    state_digest_hex: &str,
) -> RoleStoreResult<CloudflareTenantRootRefreshDurableStateV1> {
    let bytes = decode_refresh_state_bytes("tenant-root refresh durable state", state_b64u)?;
    if bytes.is_empty()
        || bytes.len() > MAX_REFRESH_DURABLE_STATE_BYTES
        || encode_base64url_bytes_v1(&bytes) != state_b64u
    {
        return Err(store_error(
            "tenant-root refresh durable state is not canonical",
        ));
    }
    require_digest_hex("tenant-root refresh durable state digest", state_digest_hex)?;
    if encode_hex(Sha256::digest(&bytes).as_ref()) != state_digest_hex {
        return Err(store_error(
            "tenant-root refresh durable state digest does not match its bytes",
        ));
    }
    let state: CloudflareTenantRootRefreshDurableStateV1 =
        serde_json::from_slice(&bytes).map_err(|error| {
            store_error(format!(
                "tenant-root refresh durable state decode failed: {error}"
            ))
        })?;
    state.validate()?;
    let canonical = serde_json::to_vec(&state).map_err(|error| {
        store_error(format!(
            "tenant-root refresh durable state re-encode failed: {error}"
        ))
    })?;
    if canonical != bytes {
        return Err(store_error(
            "tenant-root refresh durable state is not canonical JSON",
        ));
    }
    Ok(state)
}

pub(super) fn refresh_replay_state_for_command(
    stored: &StoredTenantRootCommandReplayV1,
    command_bytes: &[u8],
) -> RoleStoreResult<CloudflareTenantRootRefreshDurableStateV1> {
    let state = stored.refresh_state.clone().ok_or_else(|| {
        store_error("tenant-root refresh replay row omitted durable refresh state")
    })?;
    if state.command_bytes()? != command_bytes {
        return Err(store_error(
            "tenant-root refresh durable command bytes do not match the retry",
        ));
    }
    Ok(state)
}

#[derive(Clone, Copy)]
pub(super) enum TenantRootCommandAdmissionV1 {
    InitialCreation(TenantRootProtocolDigestV1),
    AuthorizedCleanup(TenantRootProtocolDigestV1),
}

impl TenantRootCommandAdmissionV1 {
    pub(super) const fn digest(self) -> TenantRootProtocolDigestV1 {
        match self {
            Self::InitialCreation(digest) | Self::AuthorizedCleanup(digest) => digest,
        }
    }
}

/// Durable role-local decision for one exact tenant-root command retry.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootCommandReplayDecisionV1 {
    /// The caller owns the newly persisted reservation and may execute once.
    Execute {
        /// Exact reservation required to commit a terminal receipt.
        reservation: ReservedTenantRootCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        /// Exact token reconstructed from the validated reserved replay row.
        reservation: ReservedTenantRootCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        /// Exact token reconstructed from the validated executed replay row.
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact previously committed successful receipt bytes.
    ReplayCompleted {
        /// Previously committed signed public receipt bytes.
        receipt_bytes: Vec<u8>,
    },
    /// Return the exact previously committed failure receipt bytes.
    ReplayFailed {
        /// Previously committed signed public failure-receipt bytes.
        failure_receipt_bytes: Vec<u8>,
    },
}

/// Executable insert-pending command issued by the role's control plane.
///
/// Fields remain private so a caller cannot forge the reserved operation or
/// substitute a different local row after reservation.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootInsertPendingCommandV1 {
    pub(super) scope: TenantRootCommandScopeV1,
    pub(super) reservation: ReservedTenantRootCommandV1,
    pub(super) record: CloudflareTenantRootRoleShareRecordV1,
    pub(super) expected_revision: i64,
    pub(super) operation_payload_digest: TenantRootProtocolDigestV1,
}

/// Local inputs for one issuer-authorized initial role creation.
///
/// The role store derives the pending lifecycle branch from the exact verified
/// installation-evidence wire. Callers provide only the server-resolved
/// identity and the locally sealed share material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootInitialCreationShareInputV1 {
    pub(super) identity: TenantRootIdentityV1,
    pub(super) sealed_online_share: TenantRootSealedOnlineRoleShareV1,
    pub(super) staged_at_ms: u64,
}

impl CloudflareTenantRootInitialCreationShareInputV1 {
    /// Creates the local sealed-share inputs for one initial role installation.
    pub(crate) fn new(
        identity: TenantRootIdentityV1,
        sealed_online_share: TenantRootSealedOnlineRoleShareV1,
        staged_at_ms: u64,
    ) -> Self {
        Self {
            identity,
            sealed_online_share,
            staged_at_ms,
        }
    }
}

/// Creation-only input bundle coupling one verified issuer command to one exact
/// role-signed installation-evidence wire and its local sealed share material.
///
/// The bundle is intentionally non-cloneable. Its evidence token is carried
/// through reservation, execution, and successful terminalization so a caller
/// cannot substitute receipt payload bytes at a later lifecycle stage.
pub(crate) struct CloudflareTenantRootInitialCreationInputV1 {
    pub(super) command: VerifiedTenantRootRoleCreationCommandV1,
    pub(super) evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    pub(super) record: CloudflareTenantRootRoleShareRecordV1,
}

impl fmt::Debug for CloudflareTenantRootInitialCreationInputV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootInitialCreationInputV1")
            .field("command", &self.command)
            .field("evidence", &self.evidence)
            .field("record", &self.record)
            .finish()
    }
}

impl CloudflareTenantRootInitialCreationInputV1 {
    /// Returns the sealed share ciphertext, for leak tests only.
    #[cfg(test)]
    pub(crate) fn sealed_share_ciphertext_for_test(&self) -> Vec<u8> {
        use base64::Engine;
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(self.record.sealed_share().ciphertext_b64u())
            .expect("sealed share ciphertext is canonical base64url")
    }

    /// Returns the exact signed installation evidence wire bytes.
    ///
    /// Public evidence: it is what the Router-owned object verifies, and it
    /// carries no share material.
    pub(crate) fn installation_evidence_bytes(&self) -> &[u8] {
        self.evidence.canonical_bytes()
    }

    /// Builds one exact pending record from verified evidence and local share inputs.
    pub(crate) fn new(
        command: VerifiedTenantRootRoleCreationCommandV1,
        evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        share: CloudflareTenantRootInitialCreationShareInputV1,
    ) -> RoleStoreResult<Self> {
        let sealed_binding = share.sealed_online_share.binding();
        let identity_digest = share
            .identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        let evidence_digest = evidence
            .lifecycle_receipt_digest()
            .map_err(|error| store_error(error.message()))?;
        if sealed_binding.identity_digest() != identity_digest {
            return Err(store_error(
                "tenant-root initial creation sealed share identity does not match its local identity",
            ));
        }
        if sealed_binding.installation_evidence_digest() != evidence_digest {
            return Err(store_error(
                "tenant-root initial creation sealed share evidence does not match its exact wire",
            ));
        }
        let role = cloudflare_role_for_protocol(sealed_binding.role())?;
        let installation_evidence =
            CloudflareTenantRootPendingShareV1::from_verified_installation_evidence(
                &evidence,
                share.staged_at_ms,
            )?;
        let sealed_share =
            CloudflareTenantRootSealedRoleShareV1::new(share.sealed_online_share.ciphertext())?;
        let record = CloudflareTenantRootRoleShareRecordV1::new(
            CloudflareTenantRootRoleShareRecordInputV1 {
                identity: share.identity,
                custody_lineage: sealed_binding.custody_lineage(),
                epoch: sealed_binding.epoch(),
                role,
                sealed_share,
                share_commitment: sealed_binding.share_commitment().clone(),
                epoch_wrapping_key_ref: sealed_binding.epoch_wrapping_key_ref().to_owned(),
                lifecycle: CloudflareTenantRootRoleShareLifecycleV1::Pending(installation_evidence),
                created_at_ms: share.staged_at_ms,
                updated_at_ms: share.staged_at_ms,
            },
        )?;
        validate_initial_creation_binding(&command, &evidence, &record)?;
        Ok(Self {
            command,
            evidence,
            record,
        })
    }
}

/// Executable initial-creation insertion command retaining its exact evidence token.
pub(crate) struct CloudflareTenantRootInitialCreationPendingCommandV1 {
    pub(super) command: CloudflareTenantRootInsertPendingCommandV1,
    pub(super) evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
}

impl fmt::Debug for CloudflareTenantRootInitialCreationPendingCommandV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootInitialCreationPendingCommandV1")
            .field("command", &self.command)
            .field("evidence", &self.evidence)
            .finish()
    }
}

/// Executed initial-creation command retaining the evidence needed for its
/// exact successful terminal receipt payload.
pub(crate) struct CloudflareTenantRootInitialCreationExecutedCommandV1 {
    pub(super) executed: ExecutedTenantRootCommandV1,
    pub(super) evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
}

impl CloudflareTenantRootInitialCreationExecutedCommandV1 {
    /// Returns the executed command this insertion must be terminalized under.
    ///
    /// The caller signs its terminal receipt against this token and verifies
    /// the result with it, which is what binds the receipt to the exact
    /// insertion rather than to the role generally.
    pub(crate) const fn executed(&self) -> &ExecutedTenantRootCommandV1 {
        &self.executed
    }

    /// Returns the installation evidence this insertion attests.
    pub(crate) fn evidence_bytes(&self) -> &[u8] {
        self.evidence.canonical_bytes()
    }
}

impl fmt::Debug for CloudflareTenantRootInitialCreationExecutedCommandV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootInitialCreationExecutedCommandV1")
            .field("executed", &self.executed)
            .field("evidence", &self.evidence)
            .finish()
    }
}

/// Local inputs for one issuer-authorized refresh role installation.
///
/// The sealed provider result retains the exact binding that authenticated the
/// refresh evidence, role, epoch, commitment, and wrapping-key reference.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRefreshShareInputV1 {
    /// Server-resolved logical root identity.
    pub(super) identity: TenantRootIdentityV1,
    /// Provider ciphertext containing the newly sealed role share.
    pub(super) sealed_online_share: TenantRootSealedOnlineRoleShareV1,
    /// Initial durable staging time for the pending row.
    pub(super) staged_at_ms: u64,
}

impl CloudflareTenantRootRefreshShareInputV1 {
    /// Creates the local sealed-share inputs for one refresh installation.
    pub(crate) fn new(
        identity: TenantRootIdentityV1,
        sealed_online_share: TenantRootSealedOnlineRoleShareV1,
        staged_at_ms: u64,
    ) -> Self {
        Self {
            identity,
            sealed_online_share,
            staged_at_ms,
        }
    }
}

/// Refresh-only input bundle coupling one verified issuer command to one exact
/// role-signed installation-evidence wire and its local sealed share material.
///
/// The bundle is intentionally non-cloneable. Its evidence token is carried
/// through reservation, execution, and successful terminalization so receipt
/// payload bytes cannot be substituted after the provider call.
pub(crate) struct CloudflareTenantRootRefreshInputV1 {
    pub(super) command: VerifiedTenantRootRoleRefreshCommandV1,
    pub(super) evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    pub(super) record: CloudflareTenantRootRoleShareRecordV1,
}

impl fmt::Debug for CloudflareTenantRootRefreshInputV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRefreshInputV1")
            .field("command", &self.command)
            .field("evidence", &self.evidence)
            .field("record", &self.record)
            .finish()
    }
}

impl CloudflareTenantRootRefreshInputV1 {
    /// Returns the exact signed installation evidence wire bytes.
    pub(crate) fn installation_evidence_bytes(&self) -> &[u8] {
        self.evidence.canonical_bytes()
    }

    /// Builds one exact pending record from verified refresh evidence and local
    /// provider-sealed share inputs.
    pub(crate) fn new(
        command: VerifiedTenantRootRoleRefreshCommandV1,
        evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
        share: CloudflareTenantRootRefreshShareInputV1,
    ) -> RoleStoreResult<Self> {
        let sealed_binding = share.sealed_online_share.binding();
        let evidence_digest = validate_refresh_command_evidence(&command, &evidence)?;
        let replay_key_digest = command
            .scope()
            .key()
            .storage_key_digest()
            .map_err(|error| store_error(error.message()))?;
        let identity_digest = share
            .identity
            .digest()
            .map_err(|error| store_error(error.message()))?;
        validate_refresh_sealed_binding(
            &command,
            &evidence,
            sealed_binding,
            identity_digest,
            evidence_digest,
        )?;
        let role = cloudflare_role_for_protocol(sealed_binding.role())?;
        let pending =
            CloudflareTenantRootPendingShareV1::from_verified_refresh_installation_evidence(
                &evidence,
                share.staged_at_ms,
                replay_key_digest,
            )?;
        let sealed_share =
            CloudflareTenantRootSealedRoleShareV1::new(share.sealed_online_share.ciphertext())?;
        let record = CloudflareTenantRootRoleShareRecordV1::new(
            CloudflareTenantRootRoleShareRecordInputV1 {
                identity: share.identity,
                custody_lineage: sealed_binding.custody_lineage(),
                epoch: sealed_binding.epoch(),
                role,
                sealed_share,
                share_commitment: sealed_binding.share_commitment().clone(),
                epoch_wrapping_key_ref: sealed_binding.epoch_wrapping_key_ref().to_owned(),
                lifecycle: CloudflareTenantRootRoleShareLifecycleV1::Pending(pending),
                created_at_ms: share.staged_at_ms,
                updated_at_ms: share.staged_at_ms,
            },
        )?;
        validate_refresh_record_sealed_binding(&record, sealed_binding)?;
        validate_refresh_record_binding(&command, &evidence, &record)?;
        Ok(Self {
            command,
            evidence,
            record,
        })
    }
}

pub(super) fn validate_refresh_record_sealed_binding(
    record: &CloudflareTenantRootRoleShareRecordV1,
    sealed_binding: &TenantRootOnlineRoleShareBindingV1,
) -> RoleStoreResult<()> {
    let record_identity = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let record_role = cloudflare_role_for_protocol(sealed_binding.role())?;
    if record_identity != sealed_binding.identity_digest()
        || record.custody_lineage != sealed_binding.custody_lineage()
        || record.epoch != sealed_binding.epoch()
        || record.role != record_role
        || record.share_commitment != *sealed_binding.share_commitment()
        || record.epoch_wrapping_key_ref != sealed_binding.epoch_wrapping_key_ref()
    {
        return Err(store_error(
            "tenant-root refresh role-share record does not match its sealed binding",
        ));
    }
    Ok(())
}

/// Executed refresh insertion retaining the exact evidence needed to produce
/// its successful terminal receipt payload.
pub(crate) struct CloudflareTenantRootRefreshExecutedCommandV1 {
    pub(super) executed: ExecutedTenantRootCommandV1,
    pub(super) evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
}

impl CloudflareTenantRootRefreshExecutedCommandV1 {
    /// Returns the executed command this insertion must be terminalized under.
    pub(crate) const fn executed(&self) -> &ExecutedTenantRootCommandV1 {
        &self.executed
    }

    /// Returns the installation evidence this insertion attests.
    pub(crate) fn evidence_bytes(&self) -> &[u8] {
        self.evidence.canonical_bytes()
    }
}

impl fmt::Debug for CloudflareTenantRootRefreshExecutedCommandV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CloudflareTenantRootRefreshExecutedCommandV1")
            .field("executed", &self.executed)
            .field("evidence", &self.evidence)
            .finish()
    }
}

/// Exact durable admission token for a verified refresh command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootRefreshAdmissionV1 {
    pub(super) key: TenantRootCommandReplayKeyV1,
    pub(super) command_digest: TenantRootProtocolDigestV1,
    pub(super) reserved_at_ms: u64,
}

impl CloudflareTenantRootRefreshAdmissionV1 {
    pub(crate) const fn key(&self) -> &TenantRootCommandReplayKeyV1 {
        &self.key
    }

    pub(crate) const fn command_digest(&self) -> TenantRootProtocolDigestV1 {
        self.command_digest
    }

    pub(crate) const fn reserved_at_ms(&self) -> u64 {
        self.reserved_at_ms
    }
}

/// Admission result returned before refresh randomness or provider writes.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootRefreshAdmissionDecisionV1 {
    Execute {
        admission: CloudflareTenantRootRefreshAdmissionV1,
        durable_state: CloudflareTenantRootRefreshDurableStateV1,
    },
    ResumeExecution {
        admission: CloudflareTenantRootRefreshAdmissionV1,
        durable_state: CloudflareTenantRootRefreshDurableStateV1,
    },
    ResumeCompletion {
        admission: CloudflareTenantRootRefreshAdmissionV1,
        durable_state: CloudflareTenantRootRefreshDurableStateV1,
    },
    ReplayCompleted {
        receipt_bytes: Vec<u8>,
        durable_state: CloudflareTenantRootRefreshDurableStateV1,
    },
    ReplayFailed {
        failure_receipt_bytes: Vec<u8>,
    },
}

/// Durable decision for one creation-only pending-row reservation.
#[derive(Debug)]
pub(crate) enum CloudflareTenantRootInitialCreationDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootInitialCreationPendingCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        command: CloudflareTenantRootInitialCreationPendingCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        executed: CloudflareTenantRootInitialCreationExecutedCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Read-only admission decision before a creation attempt draws a role share.
///
/// A completed retry returns its exact public receipt here. Reserved or
/// executed retries remain in progress because their random scalar cannot be
/// regenerated after the original request ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootInitialCreationPreflightV1 {
    Fresh,
    InProgress,
    ReplayCompleted { receipt_bytes: Vec<u8> },
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Result of one role-local initial-creation persistence attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootInitialCreationPersistenceOutcomeV1 {
    /// This call persisted the successful terminal receipt.
    Committed { receipt_bytes: Vec<u8> },
    /// A reservation or execution checkpoint already owns this command.
    InProgress,
    /// An identical command already committed the exact successful receipt.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// An identical command already committed the exact failure receipt.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Executable initial-activation command issued by the role's control plane.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootActivateInitialPendingCommandV1 {
    pub(super) scope: TenantRootCommandScopeV1,
    pub(super) reservation: ReservedTenantRootCommandV1,
    pub(super) pending: CloudflareStoredTenantRootRoleShareV1,
    pub(super) activation: CloudflareTenantRootActivationV1,
    pub(super) updated_at_ms: u64,
    pub(super) expected_revision: i64,
}

/// Executable active-epoch-swap command issued by the role's control plane.
#[derive(Debug, PartialEq, Eq)]
pub struct CloudflareTenantRootSwapActiveEpochCommandV1 {
    pub(super) scope: TenantRootCommandScopeV1,
    pub(super) reservation: ReservedTenantRootCommandV1,
    pub(super) active: CloudflareStoredTenantRootRoleShareV1,
    pub(super) pending: CloudflareStoredTenantRootRoleShareV1,
    pub(super) activation: CloudflareTenantRootActivationV1,
    pub(super) retirement: CloudflareTenantRootRetirementV1,
    pub(super) updated_at_ms: u64,
    pub(super) expected_active_revision: i64,
    pub(super) expected_pending_revision: i64,
}

/// Executable pending-cleanup command issued by the role's control plane.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootCleanupPendingCommandV1 {
    pub(super) scope: TenantRootCommandScopeV1,
    pub(super) reservation: ReservedTenantRootCommandV1,
    pub(super) pending: CloudflareStoredTenantRootRoleShareV1,
    pub(super) expected_revision: i64,
    pub(super) operation_payload_digest: TenantRootProtocolDigestV1,
}

/// Executable retired-cleanup command issued by the role's control plane.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CloudflareTenantRootCleanupRetiredCommandV1 {
    pub(super) scope: TenantRootCommandScopeV1,
    pub(super) reservation: ReservedTenantRootCommandV1,
    pub(super) retired: CloudflareStoredTenantRootRoleShareV1,
    pub(super) expected_retired_revision: i64,
    pub(super) expected_active_epoch: TenantRootShareEpoch,
    pub(super) expected_active_revision: i64,
    pub(super) operation_payload_digest: TenantRootProtocolDigestV1,
}

pub(crate) struct CloudflareTenantRootAuthorizedCleanupPendingCommandV1 {
    pub(super) command: CloudflareTenantRootCleanupPendingCommandV1,
    pub(super) authorization: VerifiedTenantRootRoleCleanupCommandV1,
}

pub(crate) struct CloudflareTenantRootAuthorizedCleanupRetiredCommandV1 {
    pub(super) command: CloudflareTenantRootCleanupRetiredCommandV1,
    pub(super) authorization: VerifiedTenantRootRoleCleanupCommandV1,
}

pub(crate) enum CloudflareTenantRootAuthorizedCleanupCommandV1 {
    Pending(CloudflareTenantRootAuthorizedCleanupPendingCommandV1),
    Retired(CloudflareTenantRootAuthorizedCleanupRetiredCommandV1),
}

pub(crate) struct CloudflareTenantRootAuthorizedCleanupExecutedCommandV1 {
    pub(super) executed: ExecutedTenantRootCommandV1,
    pub(super) authorization: VerifiedTenantRootRoleCleanupCommandV1,
}

/// Durable decision for one insert-pending command reservation.
#[derive(Debug, PartialEq, Eq)]
pub enum CloudflareTenantRootInsertPendingDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootInsertPendingCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        /// Exact command rebuilt from the request payload and durable reservation.
        command: CloudflareTenantRootInsertPendingCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        /// Exact token reconstructed from the validated executed replay row.
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Durable decision for one initial-activation command reservation.
#[derive(Debug, PartialEq, Eq)]
pub enum CloudflareTenantRootActivateInitialPendingDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootActivateInitialPendingCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        /// Exact command rebuilt from the request payload and durable reservation.
        command: CloudflareTenantRootActivateInitialPendingCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        /// Exact token reconstructed from the validated executed replay row.
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Durable decision for one active-epoch-swap command reservation.
#[derive(Debug, PartialEq, Eq)]
pub enum CloudflareTenantRootSwapActiveEpochDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootSwapActiveEpochCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        /// Exact command rebuilt from the request payload and durable reservation.
        command: CloudflareTenantRootSwapActiveEpochCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        /// Exact token reconstructed from the validated executed replay row.
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Durable decision for one pending-cleanup command reservation.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootCleanupPendingDecisionV1 {
    /// The caller owns the newly reserved command and may execute it once.
    Execute {
        command: CloudflareTenantRootCleanupPendingCommandV1,
    },
    /// An identical command already owns this role-local session.
    InProgress,
    /// The reservation is durable and execution may be resumed.
    ResumeExecution {
        /// Exact command rebuilt from the request payload and durable reservation.
        command: CloudflareTenantRootCleanupPendingCommandV1,
    },
    /// The lifecycle mutation is durably checkpointed and may be terminalized.
    ResumeCompletion {
        /// Exact token reconstructed from the validated executed replay row.
        executed: ExecutedTenantRootCommandV1,
    },
    /// Return the exact prior successful receipt bytes.
    ReplayCompleted { receipt_bytes: Vec<u8> },
    /// Return the exact prior failure receipt bytes.
    ReplayFailed { failure_receipt_bytes: Vec<u8> },
}

/// Durable decision for one retired-cleanup command reservation.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootCleanupRetiredDecisionV1 {
    Execute {
        command: CloudflareTenantRootCleanupRetiredCommandV1,
    },
    InProgress,
    ResumeExecution {
        command: CloudflareTenantRootCleanupRetiredCommandV1,
    },
    ResumeCompletion {
        executed: ExecutedTenantRootCommandV1,
    },
    ReplayCompleted {
        receipt_bytes: Vec<u8>,
    },
    ReplayFailed {
        failure_receipt_bytes: Vec<u8>,
    },
}

pub(crate) enum CloudflareTenantRootAuthorizedCleanupDecisionV1 {
    Execute {
        command: CloudflareTenantRootAuthorizedCleanupCommandV1,
    },
    InProgress,
    ResumeExecution {
        command: CloudflareTenantRootAuthorizedCleanupCommandV1,
    },
    ResumeCompletion {
        executed: CloudflareTenantRootAuthorizedCleanupExecutedCommandV1,
    },
    /// The managed-restore source was consumed by the forward-refresh CAS;
    /// checkpoint the authorized cleanup so its provider cleanup can proceed.
    RetiredAlreadyAbsent {
        reservation: ReservedTenantRootCommandV1,
        authorization: VerifiedTenantRootRoleCleanupCommandV1,
    },
    /// An abandoned ceremony's unrecorded material: remove any pending initial
    /// row and tombstone the lineage in one batch.
    AbandonedCeremony {
        reservation: ReservedTenantRootCommandV1,
        authorization: VerifiedTenantRootRoleCleanupCommandV1,
    },
    ReplayCompleted {
        receipt_bytes: Vec<u8>,
    },
    ReplayFailed,
}

/// Result of persisting one terminal tenant-root command receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloudflareTenantRootCommandTerminalCommitV1 {
    /// This call committed the terminal receipt.
    Committed {
        /// Exact committed signed public receipt bytes.
        receipt_bytes: Vec<u8>,
    },
    /// Another identical call already committed these exact receipt bytes.
    Replay {
        /// Exact previously committed signed public receipt bytes.
        receipt_bytes: Vec<u8>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TenantRootCommandTerminalKindV1 {
    Completed,
    Failed,
}

pub(super) struct TenantRootCommandTerminalInputV1 {
    pub(super) executed: ExecutedTenantRootCommandV1,
    pub(super) receipt: VerifiedTenantRootCommandSuccessReceiptV1,
}

pub(super) struct TenantRootCommandTerminalCommitDataV1 {
    pub(super) key: TenantRootCommandReplayKeyV1,
    pub(super) command_digest: TenantRootProtocolDigestV1,
    pub(super) reserved_at_ms: u64,
    pub(super) executed_at_ms: Option<u64>,
    pub(super) receipt_bytes: Vec<u8>,
    pub(super) receipt_digest: TenantRootProtocolDigestV1,
    pub(super) terminal_at_ms: u64,
    pub(super) terminal_kind: TenantRootCommandTerminalKindV1,
}

pub(super) struct DecodedTenantRootCommandTerminalReceiptV1 {
    pub(super) receipt_bytes: Vec<u8>,
    pub(super) receipt_digest: TenantRootProtocolDigestV1,
    pub(super) terminal_at_ms: u64,
}

impl TenantRootCommandTerminalInputV1 {
    pub(super) fn into_commit_data(self) -> RoleStoreResult<TenantRootCommandTerminalCommitDataV1> {
        let Self { executed, receipt } = self;
        if receipt.key() != executed.key()
            || receipt.command_digest() != executed.command_digest()
        {
            return Err(store_error(
                "tenant-root successful receipt does not match its executed command",
            ));
        }
        let key = *executed.key();
        let command_digest = executed.command_digest();
        let reserved_at_ms = executed.reserved_at_ms();
        let executed_at_ms = executed.executed_at_ms();
        let receipt_digest = receipt.digest();
        let terminal_at_ms = receipt.terminal_at_ms();
        executed
            .complete(receipt_digest, terminal_at_ms)
            .map_err(|error| store_error(error.message()))?;
        Ok(TenantRootCommandTerminalCommitDataV1 {
            key,
            command_digest,
            reserved_at_ms,
            executed_at_ms: Some(executed_at_ms),
            receipt_bytes: receipt.into_canonical_bytes(),
            receipt_digest,
            terminal_at_ms,
            terminal_kind: TenantRootCommandTerminalKindV1::Completed,
        })
    }
}

impl TenantRootCommandTerminalKindV1 {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub(super) const fn expected_status(self) -> &'static str {
        match self {
            Self::Completed => "executed",
            Self::Failed => "reserved",
        }
    }

    pub(super) const fn expected_outcome(self) -> TenantRootCommandTerminalOutcomeV1 {
        match self {
            Self::Completed => TenantRootCommandTerminalOutcomeV1::Success,
            Self::Failed => TenantRootCommandTerminalOutcomeV1::Failure,
        }
    }
}
