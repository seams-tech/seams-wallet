//! Online-share and managed-backup provider traits, provider configuration, artifacts and seal helpers.

use super::*;

/// Operations needed by one role-local online-share provider.
pub(crate) trait TenantRootOnlineRoleShareProviderV1 {
    fn seal_online_role_share(
        &mut self,
        request: &TenantRootOnlineRoleShareSealRequestV1,
    ) -> RouterAbDerivationResult<Vec<u8>>;

    fn open_online_role_share(
        &mut self,
        sealed: TenantRootSealedOnlineRoleShareV1,
    ) -> RouterAbDerivationResult<VerifiedTenantRootOnlineRoleShareV1>;
}

/// Operations needed by one role-local managed-backup provider.
pub(crate) trait TenantRootManagedBackupProviderV1 {
    async fn seal_managed_backup(
        &mut self,
        request: &TenantRootManagedBackupSealRequestV1,
    ) -> RouterAbDerivationResult<Vec<u8>>;

    async fn open_managed_backup(
        &mut self,
        backup: VerifiedTenantRootManagedBackupV1,
    ) -> RouterAbDerivationResult<VerifiedTenantRootManagedBackupShareV1>;
}

/// Provider references for one role-local ceremony attempt. The epoch is derived from evidence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TenantRootRoleRuntimeProviderConfigV1 {
    pub(super) online_epoch_wrapping_key_ref: String,
    pub(super) managed_backup_provider_id: String,
    pub(super) managed_backup_key_version: String,
}

impl TenantRootRoleRuntimeProviderConfigV1 {
    pub(crate) fn new(
        online_epoch_wrapping_key_ref: impl Into<String>,
        managed_backup_provider_id: impl Into<String>,
        managed_backup_key_version: impl Into<String>,
    ) -> RouterAbDerivationResult<Self> {
        let config = Self {
            online_epoch_wrapping_key_ref: online_epoch_wrapping_key_ref.into(),
            managed_backup_provider_id: managed_backup_provider_id.into(),
            managed_backup_key_version: managed_backup_key_version.into(),
        };
        for (field, value) in [
            (
                "tenant-root online epoch wrapping-key reference",
                config.online_epoch_wrapping_key_ref.as_str(),
            ),
            (
                "tenant-root managed-backup provider id",
                config.managed_backup_provider_id.as_str(),
            ),
            (
                "tenant-root managed-backup key version",
                config.managed_backup_key_version.as_str(),
            ),
        ] {
            require_identifier(field, value)?;
        }
        Ok(config)
    }
}

/// Exact provider artifacts retained after one role-local attempt.
#[derive(Debug)]
pub(crate) struct TenantRootRoleRuntimeArtifactsV1 {
    pub(super) online_sealed: TenantRootSealedOnlineRoleShareV1,
    pub(super) managed_backup: VerifiedTenantRootManagedBackupV1,
    pub(super) provider_canary_receipt: Vec<u8>,
}

/// Exact provider artifacts for one restored epoch-one role share.
///
/// The staged share itself is consumed before this token is returned. Only
/// provider ciphertext and the signed public canary leave this boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TenantRootRestoreRefreshPromotionArtifactsV1 {
    pub(super) online_sealed: TenantRootSealedOnlineRoleShareV1,
    pub(super) provider_canary_receipt: Vec<u8>,
}

impl TenantRootRestoreRefreshPromotionArtifactsV1 {
    pub(crate) const fn online_sealed(&self) -> &TenantRootSealedOnlineRoleShareV1 {
        &self.online_sealed
    }

    pub(crate) fn provider_canary_receipt(&self) -> &[u8] {
        &self.provider_canary_receipt
    }

    pub(crate) fn into_parts(self) -> (TenantRootSealedOnlineRoleShareV1, Vec<u8>) {
        (self.online_sealed, self.provider_canary_receipt)
    }
}

/// Seals one finalized restore refresh and emits its epoch-one provider canary.
///
/// The restore command carries the exact ceremony context, while the authority
/// identifier is supplied by the owning control-plane object. Both are bound to
/// the canary before the role signer emits it.
#[allow(clippy::too_many_arguments)]
#[cfg(test)]
pub(crate) fn compose_restore_refresh_promotion_v1<Online>(
    command: VerifiedTenantRootRestoreRefreshRoleCommandV1,
    share_wire: SigningRootShareWire,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    role_signer: &crate::CloudflareTenantRootCreationRoleSignerV1,
    provider_config: &TenantRootRoleRuntimeProviderConfigV1,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    online_provider: &mut Online,
    completed_at_ms: u64,
) -> RouterAbDerivationResult<TenantRootRestoreRefreshPromotionArtifactsV1>
where
    Online: TenantRootOnlineRoleShareProviderV1,
{
    compose_restore_refresh_promotion_with_completion_time_v1(
        &command,
        share_wire,
        evidence,
        role_signer,
        provider_config,
        authority_id,
        online_provider,
        || Ok(completed_at_ms),
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn compose_restore_refresh_promotion_with_completion_time_v1<Online, CompletionTime>(
    command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
    share_wire: SigningRootShareWire,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    role_signer: &crate::CloudflareTenantRootCreationRoleSignerV1,
    provider_config: &TenantRootRoleRuntimeProviderConfigV1,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    online_provider: &mut Online,
    completion_time: CompletionTime,
) -> RouterAbDerivationResult<TenantRootRestoreRefreshPromotionArtifactsV1>
where
    Online: TenantRootOnlineRoleShareProviderV1,
    CompletionTime: FnOnce() -> RouterAbDerivationResult<u64>,
{
    let role = command.role();
    if command.context() != evidence.evidence().transcript().context() {
        return Err(malformed(
            "tenant-root restore refresh evidence does not match its signed command context",
        ));
    }
    if !matches!(
        command.context().epochs(),
        TenantRootCeremonyEpochsV1::Create {
            next: TenantRootShareEpoch::INITIAL
        }
    ) {
        return Err(malformed(
            "tenant-root restore refresh promotion requires an epoch-one create context",
        ));
    }
    validate_attempt(
        role,
        command.identity_digest(),
        command.custody_lineage(),
        TenantRootShareEpoch::INITIAL,
        &evidence,
        role_signer,
    )?;
    let commitments = tenant_root_epoch_commitments_v1(&evidence)?;
    if commitments.root_commitment() != command.stable_root_commitment() {
        return Err(malformed(
            "tenant-root restore refresh evidence commitments do not match its signed command",
        ));
    }

    let share_commitment = MpcPrfShareCommitmentWireV1::new(
        evidence
            .evidence()
            .transcript()
            .commitment()
            .to_bytes()
            .to_vec(),
    )?;
    let online_binding = TenantRootOnlineRoleShareBindingV1::new(
        command.identity_digest(),
        command.custody_lineage(),
        role,
        TenantRootShareEpoch::INITIAL,
        share_commitment,
        provider_config.online_epoch_wrapping_key_ref.clone(),
        &evidence,
    )?;
    let online_request = TenantRootOnlineRoleShareSealRequestV1::new(online_binding, share_wire)?;
    let online_ciphertext = online_provider.seal_online_role_share(&online_request)?;
    let online_sealed = online_request.complete(online_ciphertext)?;

    let opened_online =
        open_tenant_root_online_role_share_v1(online_sealed.clone(), online_provider)?;
    if opened_online.identity_digest() != command.identity_digest()
        || opened_online.custody_lineage() != command.custody_lineage()
        || opened_online.role() != role
        || opened_online.epoch() != TenantRootShareEpoch::INITIAL
        || opened_online.share_commitment() != online_sealed.binding().share_commitment()
    {
        return Err(malformed(
            "tenant-root restore refresh provider returned a share with the wrong binding",
        ));
    }
    drop(opened_online);

    let completed_at_ms = completion_time()?;
    let context = command.context();
    let canary_binding = TenantRootProviderCanaryReceiptBindingV1::new(
        command.identity_digest(),
        command.custody_lineage(),
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        commitments,
        tenant_root_provider_canary_curve_family_v1(role),
        provider_config.online_epoch_wrapping_key_ref.clone(),
        completed_at_ms,
        authority_id,
        role_signer.signing_key_id().to_owned(),
        context.issued_at_ms(),
        context.expires_at_ms(),
    )?;
    let provider_canary_receipt = role_signer
        .sign_provider_canary(canary_binding)?
        .canonical_bytes()?;
    Ok(TenantRootRestoreRefreshPromotionArtifactsV1 {
        online_sealed,
        provider_canary_receipt,
    })
}

impl TenantRootRoleRuntimeArtifactsV1 {
    pub(crate) const fn online_sealed(&self) -> &TenantRootSealedOnlineRoleShareV1 {
        &self.online_sealed
    }

    pub(crate) const fn managed_backup(&self) -> &VerifiedTenantRootManagedBackupV1 {
        &self.managed_backup
    }

    pub(crate) fn into_parts(
        self,
    ) -> (
        TenantRootSealedOnlineRoleShareV1,
        VerifiedTenantRootManagedBackupV1,
        Vec<u8>,
    ) {
        (
            self.online_sealed,
            self.managed_backup,
            self.provider_canary_receipt,
        )
    }
}

/// Composes one verified initial role attempt through online and managed sealing.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn compose_initial_tenant_root_role_runtime_v1<Online, Backup>(
    attempt: VerifiedTenantRootInitialRoleAttemptV1,
    signer: &crate::CloudflareTenantRootCreationRoleSignerV1,
    provider_config: &TenantRootRoleRuntimeProviderConfigV1,
    online_provider: &mut Online,
    managed_backup_provider: &mut Backup,
    completed_at_ms: u64,
) -> RouterAbDerivationResult<(
    VerifiedTenantRootRoleCreationCommandV1,
    VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    TenantRootRoleRuntimeArtifactsV1,
)>
where
    Online: TenantRootOnlineRoleShareProviderV1,
    Backup: TenantRootManagedBackupProviderV1,
{
    let (command, share_wire, evidence) = attempt.into_parts();
    let role = command.role();
    validate_attempt(
        role,
        command.identity_digest(),
        command.custody_lineage(),
        command.epoch(),
        &evidence,
        signer,
    )?;
    let share_commitment = MpcPrfShareCommitmentWireV1::new(
        evidence
            .evidence()
            .transcript()
            .commitment()
            .to_bytes()
            .to_vec(),
    )?;
    let online_binding = TenantRootOnlineRoleShareBindingV1::new(
        command.identity_digest(),
        command.custody_lineage(),
        role,
        command.epoch(),
        share_commitment,
        provider_config.online_epoch_wrapping_key_ref.clone(),
        &evidence,
    )?;
    let managed_share =
        MpcPrfSigningRootShareWireV1::new(Zeroizing::new(share_wire.to_bytes()).to_vec())?;
    let online_request = TenantRootOnlineRoleShareSealRequestV1::new(online_binding, share_wire)?;
    let online_ciphertext = online_provider.seal_online_role_share(&online_request)?;
    let online_sealed = online_request.complete(online_ciphertext)?;

    let context = evidence.evidence().transcript().context();
    let opened_online =
        open_tenant_root_online_role_share_v1(online_sealed.clone(), online_provider)?;
    let evidence_commitment = evidence.evidence().transcript().commitment().to_bytes();
    if opened_online.binding().share_commitment().as_bytes() != evidence_commitment.as_ref() {
        return Err(malformed(
            "tenant-root online provider returned a share with the wrong commitment",
        ));
    }
    drop(opened_online);
    if command.epoch() != TenantRootShareEpoch::INITIAL {
        return Err(malformed(
            "tenant-root initial creation canary requires the initial epoch",
        ));
    }
    let commitments = tenant_root_epoch_commitments_v1(&evidence)?;
    let canary_binding = TenantRootProviderCanaryReceiptBindingV1::new(
        command.identity_digest(),
        command.custody_lineage(),
        TenantRootActivationReceiptTransitionV1::InitialCreation,
        TenantRootShareEpoch::INITIAL,
        commitments,
        tenant_root_provider_canary_curve_family_v1(role),
        provider_config.online_epoch_wrapping_key_ref.clone(),
        completed_at_ms,
        command.authority_id(),
        signer.signing_key_id().to_owned(),
        context.issued_at_ms(),
        context.expires_at_ms(),
    )?;
    let provider_canary_receipt = signer.sign_provider_canary(canary_binding)?;
    let provider_canary_receipt = provider_canary_receipt.canonical_bytes()?;
    let managed_binding = TenantRootManagedBackupBindingV1::from_verified_installation_evidence(
        &evidence,
        provider_config.managed_backup_provider_id.clone(),
        provider_config.managed_backup_key_version.clone(),
        signer.signing_key_id().to_owned(),
        context.issued_at_ms(),
    )?;
    let managed_request =
        TenantRootManagedBackupSealRequestV1::new(managed_binding.clone(), managed_share)?;
    let managed_ciphertext = managed_backup_provider
        .seal_managed_backup(&managed_request)
        .await?;
    let signed_backup = signer.sign_managed_backup(managed_request, managed_ciphertext)?;
    let managed_backup = verify_managed_backup_roundtrip_v1(
        &signed_backup,
        &managed_binding,
        &signer.verifying_key_bytes(),
        managed_backup_provider,
    )
    .await
    .map_err(|error| {
        RouterAbDerivationError::new(
            RouterAbDerivationErrorCode::MalformedInput,
            format!(
                "tenant-root managed-backup provider roundtrip was refused: {}",
                error.message()
            ),
        )
    })?;
    let artifacts = TenantRootRoleRuntimeArtifactsV1 {
        online_sealed,
        managed_backup,
        provider_canary_receipt,
    };
    Ok((command, evidence, artifacts))
}

/// Seals one verified refresh role attempt into the exact pending D1 input.
///
/// Refresh finalization owns the current share and emits this verified token;
/// this adapter is the only boundary that turns its next-epoch share into
/// provider ciphertext. The provider result is opened immediately so a bad
/// provider response cannot reach D1.
#[cfg(feature = "workers-rs")]
#[cfg(test)]
pub(crate) fn compose_refresh_tenant_root_role_runtime_v1<Online>(
    attempt: VerifiedTenantRootRefreshRoleAttemptV1,
    identity: TenantRootIdentityV1,
    provider_config: &TenantRootRoleRuntimeProviderConfigV1,
    online_provider: &mut Online,
    staged_at_ms: u64,
) -> RouterAbProtocolResult<CloudflareTenantRootRefreshInputV1>
where
    Online: TenantRootOnlineRoleShareProviderV1,
{
    let (command, share_wire, evidence) = attempt.into_parts();
    let (command, evidence, online_sealed, _) = compose_refresh_role_online_artifacts_v1(
        command,
        share_wire,
        evidence,
        &identity,
        provider_config,
        online_provider,
    )?;
    CloudflareTenantRootRefreshInputV1::new(
        command,
        evidence,
        CloudflareTenantRootRefreshShareInputV1::new(identity, online_sealed, staged_at_ms),
    )
    .map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("tenant-root refresh persistence input was refused: {error}"),
        )
    })
}

pub(super) fn compose_refresh_role_online_artifacts_v1<Online>(
    command: VerifiedTenantRootRoleRefreshCommandV1,
    share_wire: SigningRootShareWire,
    evidence: VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    identity: &TenantRootIdentityV1,
    provider_config: &TenantRootRoleRuntimeProviderConfigV1,
    online_provider: &mut Online,
) -> RouterAbProtocolResult<(
    VerifiedTenantRootRoleRefreshCommandV1,
    VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    TenantRootSealedOnlineRoleShareV1,
    MpcPrfSigningRootShareWireV1,
)>
where
    Online: TenantRootOnlineRoleShareProviderV1,
{
    let identity_digest = identity.digest().map_err(candidate_derivation_error)?;
    if identity_digest != command.identity_digest() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh sealing identity does not match its authorized command",
        ));
    }
    let transcript = evidence.evidence().transcript();
    let share_commitment =
        MpcPrfShareCommitmentWireV1::new(transcript.commitment().to_bytes().to_vec())
            .map_err(candidate_derivation_error)?;
    let managed_share =
        MpcPrfSigningRootShareWireV1::new(Zeroizing::new(share_wire.to_bytes()).to_vec())
            .map_err(candidate_derivation_error)?;
    let online_binding = TenantRootOnlineRoleShareBindingV1::new(
        command.identity_digest(),
        command.custody_lineage(),
        command.role(),
        command.next_epoch(),
        share_commitment,
        provider_config.online_epoch_wrapping_key_ref.clone(),
        &evidence,
    )
    .map_err(candidate_derivation_error)?;
    let online_request = TenantRootOnlineRoleShareSealRequestV1::new(online_binding, share_wire)
        .map_err(candidate_derivation_error)?;
    let online_ciphertext = online_provider
        .seal_online_role_share(&online_request)
        .map_err(candidate_derivation_error)?;
    let online_sealed = online_request
        .complete(online_ciphertext)
        .map_err(candidate_derivation_error)?;
    let opened_online =
        open_tenant_root_online_role_share_v1(online_sealed.clone(), online_provider)
            .map_err(candidate_derivation_error)?;
    if opened_online.identity_digest() != identity_digest
        || opened_online.custody_lineage() != command.custody_lineage()
        || opened_online.role() != command.role()
        || opened_online.epoch() != command.next_epoch()
        || opened_online.share_commitment() != online_sealed.binding().share_commitment()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root refresh provider returned a share with the wrong binding",
        ));
    }
    drop(opened_online);
    Ok((command, evidence, online_sealed, managed_share))
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn seal_refresh_role_for_persistence_v1<Online, Backup>(
    attempt: VerifiedTenantRootRefreshRoleAttemptV1,
    role_signer: &crate::CloudflareTenantRootCreationRoleSignerV1,
    identity: TenantRootIdentityV1,
    provider_config: &TenantRootRoleRuntimeProviderConfigV1,
    online_provider: &mut Online,
    managed_backup_provider: &mut Backup,
    staged_at_ms: u64,
) -> RouterAbProtocolResult<(
    CloudflareTenantRootRefreshInputV1,
    VerifiedTenantRootManagedBackupV1,
    Vec<u8>,
)>
where
    Online: TenantRootOnlineRoleShareProviderV1,
    Backup: TenantRootManagedBackupProviderV1,
{
    let (command, share_wire, evidence) = attempt.into_parts();
    validate_attempt(
        command.role(),
        command.identity_digest(),
        command.custody_lineage(),
        command.next_epoch(),
        &evidence,
        role_signer,
    )
    .map_err(candidate_derivation_error)?;
    let (command, evidence, online_sealed, managed_share) =
        compose_refresh_role_online_artifacts_v1(
            command,
            share_wire,
            evidence,
            &identity,
            provider_config,
            online_provider,
        )?;
    let context = evidence.evidence().transcript().context();
    let commitments =
        tenant_root_epoch_commitments_v1(&evidence).map_err(candidate_derivation_error)?;
    let canary_binding = TenantRootProviderCanaryReceiptBindingV1::new(
        command.identity_digest(),
        command.custody_lineage(),
        TenantRootActivationReceiptTransitionV1::RefreshSwap,
        command.next_epoch(),
        commitments,
        tenant_root_provider_canary_curve_family_v1(command.role()),
        provider_config.online_epoch_wrapping_key_ref.clone(),
        staged_at_ms,
        command.authority_id(),
        role_signer.signing_key_id().to_owned(),
        context.issued_at_ms(),
        context.expires_at_ms(),
    )
    .map_err(candidate_derivation_error)?;
    let provider_canary_receipt = role_signer
        .sign_provider_canary(canary_binding)
        .map_err(candidate_derivation_error)?
        .canonical_bytes()
        .map_err(candidate_derivation_error)?;
    let managed_binding = TenantRootManagedBackupBindingV1::from_verified_installation_evidence(
        &evidence,
        provider_config.managed_backup_provider_id.clone(),
        provider_config.managed_backup_key_version.clone(),
        role_signer.signing_key_id().to_owned(),
        context.issued_at_ms(),
    )
    .map_err(candidate_derivation_error)?;
    let managed_request =
        TenantRootManagedBackupSealRequestV1::new(managed_binding.clone(), managed_share)
            .map_err(candidate_derivation_error)?;
    let managed_ciphertext = managed_backup_provider
        .seal_managed_backup(&managed_request)
        .await
        .map_err(candidate_derivation_error)?;
    let signed_backup = role_signer
        .sign_managed_backup(managed_request, managed_ciphertext)
        .map_err(candidate_derivation_error)?;
    let managed_backup = verify_managed_backup_roundtrip_v1(
        &signed_backup,
        &managed_binding,
        &role_signer.verifying_key_bytes(),
        managed_backup_provider,
    )
    .await?;
    let input = CloudflareTenantRootRefreshInputV1::new(
        command,
        evidence,
        CloudflareTenantRootRefreshShareInputV1::new(identity, online_sealed, staged_at_ms),
    )
    .map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("tenant-root refresh persistence input was refused: {error}"),
        )
    })?;
    Ok((input, managed_backup, provider_canary_receipt))
}

/// Opens an online artifact and re-verifies its role share commitment.
pub(crate) fn open_tenant_root_online_role_share_v1<Provider>(
    sealed: TenantRootSealedOnlineRoleShareV1,
    provider: &mut Provider,
) -> RouterAbDerivationResult<VerifiedTenantRootOnlineRoleShareV1>
where
    Provider: TenantRootOnlineRoleShareProviderV1,
{
    provider.open_online_role_share(sealed)
}

/// Opens a managed-backup artifact and re-verifies its role share commitment.
pub(crate) async fn open_tenant_root_managed_backup_v1<Provider>(
    backup: VerifiedTenantRootManagedBackupV1,
    provider: &mut Provider,
) -> RouterAbDerivationResult<VerifiedTenantRootManagedBackupShareV1>
where
    Provider: TenantRootManagedBackupProviderV1,
{
    provider.open_managed_backup(backup).await
}

/// Reopens a freshly signed managed backup before it can cross into D1.
/// Re-parsing gives the provider the exact canonical artifact that will be
/// persisted and avoids retaining a second in-memory verified token.
pub(super) async fn verify_managed_backup_roundtrip_v1<Provider>(
    signed_backup: &TenantRootSignedManagedBackupV1,
    expected_binding: &TenantRootManagedBackupBindingV1,
    trusted_role_verifying_key: &[u8; 32],
    provider: &mut Provider,
) -> RouterAbProtocolResult<VerifiedTenantRootManagedBackupV1>
where
    Provider: TenantRootManagedBackupProviderV1,
{
    let canonical_bytes = signed_backup
        .canonical_bytes()
        .map_err(candidate_derivation_error)?;
    let reparsed = TenantRootSignedManagedBackupV1::decode_canonical_bytes(&canonical_bytes)
        .map_err(candidate_derivation_error)?;
    let for_open = reparsed
        .verify(expected_binding, trusted_role_verifying_key)
        .map_err(candidate_derivation_error)?;
    let opened = provider
        .open_managed_backup(for_open)
        .await
        .map_err(candidate_derivation_error)?;
    if opened.binding() != expected_binding {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root managed-backup provider returned a share with the wrong binding",
        ));
    }
    drop(opened);
    signed_backup
        .verify(expected_binding, trusted_role_verifying_key)
        .map_err(candidate_derivation_error)
}

pub(super) fn validate_attempt(
    role: TwoPartyDeriverRole,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    epoch: TenantRootShareEpoch,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    signer: &crate::CloudflareTenantRootCreationRoleSignerV1,
) -> RouterAbDerivationResult<()> {
    let transcript = evidence.evidence().transcript();
    let context = transcript.context();
    let evidence_epoch = installation_epoch(context.epochs());
    if context.identity_digest() != identity_digest
        || context.custody_lineage() != custody_lineage
        || transcript.role() != role
        || evidence_epoch != epoch
        || signer.role() != role
        || signer.signing_key_id() != context.signing_key_id(role)
    {
        return Err(malformed(
            "tenant-root role attempt, installation evidence, and signer do not match",
        ));
    }
    TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
        evidence.canonical_bytes(),
        &signer.verifying_key_bytes(),
    )
    .map_err(|_| {
        malformed("tenant-root installation evidence does not verify with the constrained signer")
    })?;
    Ok(())
}

pub(super) fn installation_epoch(epochs: TenantRootCeremonyEpochsV1) -> TenantRootShareEpoch {
    match epochs {
        TenantRootCeremonyEpochsV1::Create { next }
        | TenantRootCeremonyEpochsV1::Refresh { next, .. } => next,
    }
}

pub(super) fn tenant_root_epoch_commitments_v1(
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
) -> RouterAbDerivationResult<TenantRootEpochCommitmentsV1> {
    let transcript = evidence.evidence().transcript();
    let (deriver_a, deriver_b) = match transcript.role() {
        TwoPartyDeriverRole::DeriverA => (transcript.commitment(), transcript.peer_commitment()),
        TwoPartyDeriverRole::DeriverB => (transcript.peer_commitment(), transcript.commitment()),
    };
    TenantRootEpochCommitmentsV1::new(
        MpcPrfShareCommitmentWireV1::new(deriver_a.to_bytes().to_vec())?,
        MpcPrfShareCommitmentWireV1::new(deriver_b.to_bytes().to_vec())?,
    )
}

pub(super) const fn tenant_root_provider_canary_curve_family_v1(
    role: TwoPartyDeriverRole,
) -> TenantRootCanaryCurveFamilyV1 {
    match role {
        TwoPartyDeriverRole::DeriverA => TenantRootCanaryCurveFamilyV1::Ecdsa,
        TwoPartyDeriverRole::DeriverB => TenantRootCanaryCurveFamilyV1::Ed25519,
    }
}

pub(super) fn require_identifier(field: &'static str, value: &str) -> RouterAbDerivationResult<()> {
    if value.is_empty()
        || value.len() > 256
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(malformed(field));
    }
    Ok(())
}

pub(super) fn malformed(message: &'static str) -> RouterAbDerivationError {
    RouterAbDerivationError::new(RouterAbDerivationErrorCode::MalformedInput, message)
}
