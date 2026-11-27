//! Decoding of stored rows into role-store records.

use super::*;

/// Control-plane revision an authorized cleanup executes under.
///
/// Cleanup undoes an initial insertion, so it acts at the same control-plane
/// revision that authorized the creation it is clearing.
pub(super) const TENANT_ROOT_AUTHORIZED_CLEANUP_CONTROL_PLANE_REVISION_V1: u64 = 1;

/// Maps a stored record's role to its protocol role.
pub(super) fn tenant_root_protocol_role_of(role: CloudflareTenantRootDeriverRoleV1) -> TwoPartyDeriverRole {
    match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        CloudflareTenantRootDeriverRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    }
}

pub(super) fn record_metadata(
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> RoleStoreResult<TenantRootRoleD1MetadataV1> {
    Ok(TenantRootRoleD1MetadataV1 {
        identity_digest_hex: record.identity_digest_hex()?,
        custody_lineage_b64u: record.custody_lineage.to_base64url(),
        epoch: record.epoch.get().get(),
        role: record.role,
        lifecycle: record.lifecycle.as_str().to_owned(),
    })
}

pub(super) fn serialize_activation_receipt_bytes<S>(bytes: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&encode_base64url_bytes_v1(bytes))
}

pub(super) fn decode_activation_receipt_bytes(
    bytes: &[u8],
) -> RoleStoreResult<TenantRootSignedActivationReceiptV1> {
    if bytes.is_empty() || bytes.len() > TENANT_ROOT_ACTIVATION_RECEIPT_MAX_BYTES_V1 {
        return Err(store_error(
            "tenant-root activation receipt bytes have an invalid length",
        ));
    }
    let receipt = TenantRootSignedActivationReceiptV1::decode_canonical_bytes(bytes)
        .map_err(|error| store_error(error.message()))?;
    let canonical_bytes = receipt
        .canonical_bytes()
        .map_err(|error| store_error(error.message()))?;
    if canonical_bytes != bytes {
        return Err(store_error(
            "tenant-root activation receipt bytes are not canonical",
        ));
    }
    Ok(receipt)
}

pub(super) fn restore_import_session_tombstone_from_row(
    row: TenantRootRestoreImportSessionTombstoneD1RowV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    restore_session_id: TenantRootRestoreSessionIdV1,
    expected_role: CloudflareTenantRootDeriverRoleV1,
) -> RoleStoreResult<CloudflareTenantRootRestoreImportSessionTombstoneV1> {
    let role = CloudflareTenantRootDeriverRoleV1::parse(
        row.role
            .as_deref()
            .ok_or_else(|| store_error("tenant-root restore-session tombstone has no role"))?,
    )?;
    if role != expected_role {
        return Err(store_error(
            "tenant-root restore-session tombstone belongs to the other Deriver",
        ));
    }
    let closed_at_ms = positive_u64_from_i64(
        "tenant-root restore import session close timestamp",
        row.closed_at_ms,
    )?;
    let activation_operation = row.activation_operation.ok_or_else(|| {
        store_error("tenant-root restore-session tombstone has no activation operation")
    })?;
    let activation_receipt_encoded = row.activation_receipt_b64u.ok_or_else(|| {
        store_error("tenant-root restore-session tombstone has no activation receipt")
    })?;
    let activation_receipt_bytes = decode_base64url_bytes_v1(
        "tenant-root restore-session activation receipt",
        &activation_receipt_encoded,
    )
    .map_err(|error| store_error(error.message()))?;
    if encode_base64url_bytes_v1(&activation_receipt_bytes) != activation_receipt_encoded {
        return Err(store_error(
            "tenant-root restore-session activation receipt is not canonical",
        ));
    }
    let activation_receipt = decode_activation_receipt_bytes(&activation_receipt_bytes)?;
    let activation_receipt_digest = activation_receipt
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let stored_activation_receipt_digest = decode_lower_hex_fixed::<32>(
        "tenant-root restore-session activation receipt digest",
        row.activation_receipt_digest_hex
            .as_deref()
            .ok_or_else(|| {
                store_error(
                    "tenant-root restore-session tombstone has no activation receipt digest",
                )
            })?,
    )?;
    if activation_receipt_digest
        != TenantRootLifecycleReceiptDigestV1::from_bytes(stored_activation_receipt_digest)
            .map_err(|error| store_error(error.message()))?
        || activation_operation != activation_receipt.transition().operation()
    {
        return Err(store_error(
            "tenant-root restore-session activation receipt projection is invalid",
        ));
    }
    if activation_receipt.identity_digest() != identity_digest
        || activation_receipt.custody_lineage() != custody_lineage
        || activation_receipt.transition()
            != TenantRootActivationReceiptTransitionV1::InitialCreation
        || activation_receipt
            .availability()
            .tenant_held_external_provenance()
            .map(|provenance| provenance.restore_session_id())
            != Some(restore_session_id)
    {
        return Err(store_error(
            "tenant-root restore-session activation receipt scope is invalid",
        ));
    }
    let cleanup_receipt_encoded = row.cleanup_receipt_b64u.ok_or_else(|| {
        store_error("tenant-root restore-session tombstone has no cleanup receipt")
    })?;
    let cleanup_receipt_bytes = decode_base64url_bytes_v1(
        "tenant-root restore-session cleanup receipt",
        &cleanup_receipt_encoded,
    )
    .map_err(|error| store_error(error.message()))?;
    if cleanup_receipt_bytes.is_empty()
        || cleanup_receipt_bytes.len() > MAX_RESTORE_PROMOTION_TERMINAL_RECEIPT_BYTES
        || encode_base64url_bytes_v1(&cleanup_receipt_bytes) != cleanup_receipt_encoded
    {
        return Err(store_error(
            "tenant-root restore-session cleanup receipt is malformed",
        ));
    }
    let cleanup_receipt_digest = TenantRootLifecycleReceiptDigestV1::from_bytes(
        Sha256::digest(&cleanup_receipt_bytes).into(),
    )
    .map_err(|error| store_error(error.message()))?;
    let stored_cleanup_receipt_digest = decode_lower_hex_fixed::<32>(
        "tenant-root restore-session cleanup receipt digest",
        row.cleanup_receipt_digest_hex.as_deref().ok_or_else(|| {
            store_error("tenant-root restore-session tombstone has no cleanup receipt digest")
        })?,
    )?;
    if cleanup_receipt_digest
        != TenantRootLifecycleReceiptDigestV1::from_bytes(stored_cleanup_receipt_digest)
            .map_err(|error| store_error(error.message()))?
    {
        return Err(store_error(
            "tenant-root restore-session cleanup receipt digest is invalid",
        ));
    }
    let cleanup_receipt = CloudflareTenantRootRestoreSessionCleanupReceiptV1 {
        bytes: cleanup_receipt_bytes,
        digest: cleanup_receipt_digest,
        closed_at_ms,
    };
    let tombstone = CloudflareTenantRootRestoreImportSessionTombstoneV1 {
        identity_digest,
        custody_lineage,
        restore_session_id,
        role,
        activation_operation,
        activation_receipt_bytes,
        activation_receipt_digest,
        cleanup_receipt,
        closed_at_ms,
    };
    tombstone.validate()?;
    Ok(tombstone)
}

pub(super) fn validate_restore_refresh_promotion_timestamp(
    command: &VerifiedTenantRootRestoreRefreshRoleCommandV1,
    record: &CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1,
) -> RoleStoreResult<()> {
    let refreshed_at_ms = record.refreshed_at_ms().ok_or_else(|| {
        store_error("tenant-root restore refresh promotion has no refresh timestamp")
    })?;
    if refreshed_at_ms < command.context().issued_at_ms()
        || refreshed_at_ms > command.context().expires_at_ms()
    {
        return Err(store_error(
            "tenant-root restore refresh promotion refresh timestamp is outside its command context",
        ));
    }
    Ok(())
}

pub(super) fn accepted_loss_availability_from_verified_receipt(
    activation: &VerifiedTenantRootSignedActivationReceiptV1,
    role: TenantRootManagedRestoreRoleV1,
) -> RoleStoreResult<CloudflareTenantRootAvailabilityEvidenceV1> {
    let (authorization, authorization_digest) =
        accepted_loss_authorization_from_binding(activation.binding())?;
    validate_accepted_loss_authorization_against_activation(activation.binding(), &authorization)?;
    Ok(
        CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
            authorization_digest,
            identity_digest: activation.identity_digest(),
            custody_lineage: activation.custody_lineage(),
            role,
            epoch: activation_target_epoch(activation.binding()),
            share_commitment: activation_target_commitment(activation.binding(), role).clone(),
        },
    )
}

pub(super) fn accepted_loss_authorization_from_binding(
    binding: &TenantRootActivationReceiptBindingV1,
) -> RoleStoreResult<(
    TenantRootSignedAcceptedPermanentLossAuthorizationV1,
    TenantRootAcceptedPermanentLossAuthorizationDigestV1,
)> {
    let TenantRootActivationReceiptAvailabilityV1::AcceptedPermanentDerivationLoss {
        authorization_bytes,
        authorization_digest,
    } = binding.availability()
    else {
        return Err(store_error(
            "tenant-root activation receipt does not carry accepted-loss authorization",
        ));
    };
    let authorization =
        TenantRootSignedAcceptedPermanentLossAuthorizationV1::decode_canonical_bytes(
            authorization_bytes,
        )
        .map_err(|error| store_error(error.message()))?;
    if authorization
        .digest()
        .map_err(|error| store_error(error.message()))?
        != *authorization_digest
    {
        return Err(store_error(
            "tenant-root accepted-loss authorization digest does not match its bytes",
        ));
    }
    Ok((authorization, *authorization_digest))
}

pub(super) fn validate_accepted_loss_authorization_against_activation(
    binding: &TenantRootActivationReceiptBindingV1,
    authorization: &TenantRootSignedAcceptedPermanentLossAuthorizationV1,
) -> RoleStoreResult<()> {
    if authorization.identity_digest() != binding.identity_digest()
        || authorization.custody_lineage() != binding.custody_lineage()
        || authorization.transition() != binding.transition()
        || authorization.target_epoch() != activation_target_epoch(binding)
        || authorization.context_digest() != binding.context_digest()
        || authorization.commitments() != activation_target_commitments(binding)
        || authorization.installation_receipts() != activation_installation_receipts(binding)
        || authorization.expected_control_plane_revision()
            != binding.expected_control_plane_revision()
        || authorization.result_control_plane_revision() != binding.result_control_plane_revision()
        || authorization.issued_at_ms() != binding.issued_at_ms()
        || authorization.expires_at_ms() != binding.expires_at_ms()
    {
        return Err(store_error(
            "tenant-root accepted-loss authorization does not match activation receipt binding",
        ));
    }
    Ok(())
}

pub(super) fn validate_activation_receipt_against_backup(
    activation: &VerifiedTenantRootSignedActivationReceiptV1,
    backup: &VerifiedTenantRootManagedBackupV1,
) -> RoleStoreResult<()> {
    let binding = activation.binding();
    if binding.identity_digest() != backup.identity_digest()
        || binding.custody_lineage() != backup.custody_lineage()
    {
        return Err(store_error(
            "tenant-root activation receipt identity binding does not match managed backup",
        ));
    }
    if activation_target_epoch(binding) != backup.epoch()
        || activation_target_commitment(binding, backup.role()) != backup.share_commitment()
        || activation_installation_receipt(binding, backup.role())
            != backup.installation_receipt_digest()
        || activation_backup_receipt(binding, backup.role())? != backup.receipt_digest()
    {
        return Err(store_error(
            "tenant-root activation receipt binding does not match managed backup",
        ));
    }
    Ok(())
}

pub(super) fn validate_activation_receipt_against_record(
    activation_receipt_bytes: &[u8],
    record: &CloudflareTenantRootRoleShareRecordV1,
    availability: &CloudflareTenantRootAvailabilityEvidenceV1,
) -> RoleStoreResult<()> {
    let receipt = decode_activation_receipt_bytes(activation_receipt_bytes)?;
    let binding = receipt.binding();
    let role = record.role.managed_restore_role();
    let record_identity = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let expected_transition = if record.epoch == TenantRootShareEpoch::INITIAL {
        TenantRootActivationReceiptTransitionV1::InitialCreation
    } else {
        TenantRootActivationReceiptTransitionV1::RefreshSwap
    };
    if binding.identity_digest() != record_identity
        || binding.custody_lineage() != record.custody_lineage
        || binding.transition() != expected_transition
        || activation_target_epoch(binding) != record.epoch
        || activation_target_commitment(binding, role) != &record.share_commitment
        || activation_installation_receipt(binding, role)
            != record_installation_evidence_digest(record)?
    {
        return Err(store_error(
            "tenant-root activation receipt binding does not match the role-share record",
        ));
    }
    match availability {
        CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            role_backup_receipt_digest,
            identity_digest,
            custody_lineage,
            role: availability_role,
            epoch,
            share_commitment,
        } => {
            if *identity_digest != record_identity
                || *custody_lineage != record.custody_lineage
                || *availability_role != role
                || *epoch != record.epoch
                || share_commitment != &record.share_commitment
                || activation_backup_receipt(binding, role)? != *role_backup_receipt_digest
            {
                return Err(store_error(
                    "tenant-root activation backup evidence does not match the role-share record",
                ));
            }
        }
        CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
            authorization_digest,
            identity_digest,
            custody_lineage,
            role: availability_role,
            epoch,
            share_commitment,
        } => {
            if *identity_digest != record_identity
                || *custody_lineage != record.custody_lineage
                || *availability_role != role
                || *epoch != record.epoch
                || share_commitment != &record.share_commitment
            {
                return Err(store_error(
                    "tenant-root accepted-loss evidence does not match the role-share record",
                ));
            }
            let (authorization, receipt_digest) =
                accepted_loss_authorization_from_binding(binding)?;
            if receipt_digest != *authorization_digest {
                return Err(store_error(
                    "tenant-root accepted-loss authorization digest does not match its projection",
                ));
            }
            validate_accepted_loss_authorization_against_activation(binding, &authorization)?;
        }
        CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal { provenance } => {
            validate_tenant_held_external_provenance_against_binding(provenance, binding)?;
            if provenance.identity_digest() != record_identity
                || provenance.custody_lineage() != record.custody_lineage
            {
                return Err(store_error(
                    "tenant-root tenant-held external evidence does not match the role-share record",
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_tenant_held_external_provenance_against_binding(
    provenance: &TenantRootTenantHeldExternalProvenanceV1,
    binding: &TenantRootActivationReceiptBindingV1,
) -> RoleStoreResult<()> {
    let target_epoch = activation_target_epoch(binding);
    let target_commitments = activation_target_commitments(binding);
    let context_matches = match binding {
        TenantRootActivationReceiptBindingV1::InitialCreation(_) => {
            target_epoch == TenantRootShareEpoch::INITIAL
                && provenance.restore_context_digest() == binding.context_digest()
        }
        TenantRootActivationReceiptBindingV1::RefreshSwap(_) => {
            target_epoch != TenantRootShareEpoch::INITIAL
        }
    };
    if provenance.identity_digest() != binding.identity_digest()
        || provenance.custody_lineage() != binding.custody_lineage()
        || provenance.stable_root_commitment() != target_commitments.root_commitment()
        || !context_matches
    {
        return Err(store_error(
            "tenant-root tenant-held external provenance does not match activation scope",
        ));
    }
    Ok(())
}

pub(super) fn validate_activation_receipt_against_swap_records(
    activation: &CloudflareTenantRootActivationV1,
    active: &CloudflareStoredTenantRootRoleShareV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
) -> RoleStoreResult<()> {
    let receipt = decode_activation_receipt_bytes(&activation.activation_receipt_bytes)?;
    let TenantRootActivationReceiptBindingV1::RefreshSwap(binding) = receipt.binding() else {
        return Err(store_error(
            "tenant-root epoch swap requires a refresh activation receipt",
        ));
    };
    let active_identity = active
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let pending_identity = pending
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let active_role = active.record.role.managed_restore_role();
    let pending_role = pending.record.role.managed_restore_role();
    if active_identity != pending_identity
        || binding.identity_digest() != pending_identity
        || binding.custody_lineage() != pending.record.custody_lineage
        || binding.current_epoch() != active.record.epoch
        || binding.next_epoch() != pending.record.epoch
        || active_role != pending_role
        || activation_role_commitment(binding.current_commitments(), active_role)
            != &active.record.share_commitment
        || activation_role_commitment(binding.next_commitments(), pending_role)
            != &pending.record.share_commitment
    {
        return Err(store_error(
            "tenant-root refresh activation receipt does not match the epoch swap records",
        ));
    }
    Ok(())
}

pub(super) fn activation_target_epoch(binding: &TenantRootActivationReceiptBindingV1) -> TenantRootShareEpoch {
    match binding {
        TenantRootActivationReceiptBindingV1::InitialCreation(_) => TenantRootShareEpoch::INITIAL,
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => binding.next_epoch(),
    }
}

pub(super) fn activation_target_commitment(
    binding: &TenantRootActivationReceiptBindingV1,
    role: TenantRootManagedRestoreRoleV1,
) -> &MpcPrfShareCommitmentWireV1 {
    activation_role_commitment(activation_target_commitments(binding), role)
}

pub(super) fn activation_target_commitments(
    binding: &TenantRootActivationReceiptBindingV1,
) -> &TenantRootEpochCommitmentsV1 {
    match binding {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => binding.commitments(),
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => binding.next_commitments(),
    }
}

pub(super) fn activation_role_commitment(
    commitments: &TenantRootEpochCommitmentsV1,
    role: TenantRootManagedRestoreRoleV1,
) -> &MpcPrfShareCommitmentWireV1 {
    match role {
        TenantRootManagedRestoreRoleV1::DeriverA => commitments.deriver_a(),
        TenantRootManagedRestoreRoleV1::DeriverB => commitments.deriver_b(),
    }
}

pub(super) fn activation_installation_receipt(
    binding: &TenantRootActivationReceiptBindingV1,
    role: TenantRootManagedRestoreRoleV1,
) -> TenantRootLifecycleReceiptDigestV1 {
    let receipts = activation_installation_receipts(binding);
    match role {
        TenantRootManagedRestoreRoleV1::DeriverA => receipts.deriver_a(),
        TenantRootManagedRestoreRoleV1::DeriverB => receipts.deriver_b(),
    }
}

pub(super) fn activation_installation_receipts(
    binding: &TenantRootActivationReceiptBindingV1,
) -> TenantRootRoleInstallationReceiptsV1 {
    match binding {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => {
            binding.installation_receipts()
        }
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => {
            binding.installation_receipts()
        }
    }
}

pub(super) fn activation_backup_receipt(
    binding: &TenantRootActivationReceiptBindingV1,
    role: TenantRootManagedRestoreRoleV1,
) -> RoleStoreResult<TenantRootLifecycleReceiptDigestV1> {
    let availability = match binding {
        TenantRootActivationReceiptBindingV1::InitialCreation(binding) => binding.availability(),
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => binding.availability(),
    };
    let receipts = match availability {
        TenantRootActivationReceiptAvailabilityV1::CurrentRoleBackups { receipts, .. } => *receipts,
        TenantRootActivationReceiptAvailabilityV1::AcceptedPermanentDerivationLoss { .. }
        | TenantRootActivationReceiptAvailabilityV1::TenantHeldExternal { .. } => {
            return Err(store_error(
                "tenant-root activation receipt does not carry current-backup evidence",
            ));
        }
    };
    Ok(match role {
        TenantRootManagedRestoreRoleV1::DeriverA => receipts.deriver_a(),
        TenantRootManagedRestoreRoleV1::DeriverB => receipts.deriver_b(),
    })
}

pub(super) fn record_installation_evidence_digest(
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> RoleStoreResult<TenantRootLifecycleReceiptDigestV1> {
    match &record.lifecycle {
        CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => {
            Ok(pending.installation_evidence_digest)
        }
        CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
            Ok(active.pending.installation_evidence_digest)
        }
        CloudflareTenantRootRoleShareLifecycleV1::Retired(retired) => {
            Ok(retired.active.pending.installation_evidence_digest)
        }
    }
}

pub(super) const TENANT_ROOT_ROLE_COMMAND_PAYLOAD_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-role-command-payload/v1";

pub(super) const TENANT_ROOT_REFRESH_INSERT_PENDING_PAYLOAD_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-refresh-insert-pending-payload/v1";

pub(super) const TENANT_ROOT_AUTHORIZED_CLEANUP_PAYLOAD_DOMAIN_V1: &[u8] =
    b"seams/tenant-root-authorized-cleanup-payload/v1";

pub(super) fn validate_command_scope_for_record(
    scope: &TenantRootCommandScopeV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
    expected_revision: i64,
    operation: &'static str,
) -> RoleStoreResult<()> {
    let identity_digest = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if scope.key().identity_digest() != identity_digest
        || scope.key().custody_lineage() != record.custody_lineage
        || scope.key().role().as_str() != record.role.as_str()
        || scope.epoch() != record.epoch
    {
        return Err(store_error(format!(
            "{operation} command scope does not match its role-share record"
        )));
    }
    if expected_revision <= 0 {
        return Err(store_error(format!(
            "{operation} command has an invalid local row revision"
        )));
    }
    // Authority must be established by the caller before this module-private
    // helper accepts the scope; a raw scope does not establish issuer authority.
    let _ = scope.expected_control_plane_revision();
    Ok(())
}

#[cfg(test)]
pub(super) fn initial_creation_scope_for_record(
    command: &VerifiedTenantRootRoleCreationCommandV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
    reserved_at_ms: u64,
) -> RoleStoreResult<TenantRootCommandScopeV1> {
    command
        .require_fresh(reserved_at_ms)
        .map_err(|error| store_error(error.message()))?;
    initial_creation_scope_without_freshness(command, record)
}

pub(super) fn initial_creation_scope_without_freshness(
    command: &VerifiedTenantRootRoleCreationCommandV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> RoleStoreResult<TenantRootCommandScopeV1> {
    let scope = command.scope();
    validate_command_scope_for_record(&scope, record, 1, "tenant-root initial role creation")?;
    Ok(scope)
}

pub(super) fn cloudflare_role_for_protocol(
    role: TwoPartyDeriverRole,
) -> RoleStoreResult<CloudflareTenantRootDeriverRoleV1> {
    Ok(match role {
        TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
        TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
    })
}

pub(super) fn protocol_role_for_cloudflare(role: CloudflareTenantRootDeriverRoleV1) -> TwoPartyDeriverRole {
    match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        CloudflareTenantRootDeriverRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    }
}
