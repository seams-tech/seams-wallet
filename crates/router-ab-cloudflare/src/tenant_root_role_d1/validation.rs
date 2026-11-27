//! Validators, payload digests, encoders and small helpers of the role store.

use super::*;

pub(super) fn protocol_role_for_managed_restore(role: TenantRootManagedRestoreRoleV1) -> TwoPartyDeriverRole {
    match role {
        TenantRootManagedRestoreRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        TenantRootManagedRestoreRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    }
}

pub(super) fn validate_initial_creation_role_signer(
    creation: &CloudflareTenantRootInitialCreationInputV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
) -> RoleStoreResult<()> {
    let role = creation.command.role();
    if role_signer.role() != role {
        return Err(store_error(
            "tenant-root initial creation receipt signer role does not match its command",
        ));
    }
    if role_signer.signing_key_id()
        != creation
            .evidence
            .evidence()
            .transcript()
            .context()
            .signing_key_id(role)
    {
        return Err(store_error(
            "tenant-root initial creation receipt signer key does not match its evidence",
        ));
    }
    Ok(())
}

pub(super) fn validate_initial_creation_binding(
    command: &VerifiedTenantRootRoleCreationCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> RoleStoreResult<()> {
    record.validate()?;
    let transcript = evidence.evidence().transcript();
    let context = transcript.context();
    let record_identity = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let evidence_context_digest = context
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if command.role() != transcript.role() {
        return Err(store_error(
            "tenant-root initial creation evidence role does not match its command",
        ));
    }
    if record.role != cloudflare_role_for_protocol(transcript.role())? {
        return Err(store_error(
            "tenant-root initial creation share role does not match its evidence",
        ));
    }
    if command.identity_digest() != record_identity
        || command.identity_digest() != context.identity_digest()
        || command.custody_lineage() != record.custody_lineage
        || command.custody_lineage() != context.custody_lineage()
        || command.creation_context_digest() != evidence_context_digest
        || command.epoch() != TenantRootShareEpoch::INITIAL
        || record.epoch != TenantRootShareEpoch::INITIAL
    {
        return Err(store_error(
            "tenant-root initial creation command, evidence, and share identity do not match",
        ));
    }
    let evidence_commitment =
        MpcPrfShareCommitmentWireV1::new(transcript.commitment().to_bytes().to_vec())
            .map_err(|error| store_error(error.message()))?;
    if record.share_commitment != evidence_commitment {
        return Err(store_error(
            "tenant-root initial creation share commitment does not match its evidence",
        ));
    }
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = &record.lifecycle else {
        return Err(store_error(
            "tenant-root initial creation requires a pending role share",
        ));
    };
    let evidence_digest = evidence
        .lifecycle_receipt_digest()
        .map_err(|error| store_error(error.message()))?;
    if pending.installation_evidence_digest != evidence_digest {
        return Err(store_error(
            "tenant-root pending installation evidence digest does not match its exact wire",
        ));
    }
    Ok(())
}

pub(super) fn validate_initial_creation_success_receipt_payload(
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    receipt: &VerifiedTenantRootCommandSuccessReceiptV1,
) -> RoleStoreResult<()> {
    if receipt.payload_bytes() != evidence.canonical_bytes() {
        return Err(store_error(
            "tenant-root initial creation receipt payload does not match its exact evidence wire",
        ));
    }
    Ok(())
}

pub(super) fn validate_refresh_command_evidence(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
) -> RoleStoreResult<TenantRootLifecycleReceiptDigestV1> {
    let transcript = evidence.evidence().transcript();
    let context = transcript.context();
    let TenantRootCeremonyEpochsV1::Refresh { current, next } = context.epochs() else {
        return Err(store_error(
            "tenant-root refresh installation requires a refresh ceremony context",
        ));
    };
    let context_digest = context
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if command.identity_digest() != context.identity_digest()
        || command.custody_lineage() != context.custody_lineage()
        || command.refresh_context_digest() != context_digest
        || command.current_epoch() != current
        || command.next_epoch() != next
        || command.session_id() != context.session_id()
        || command.nonce() != context.nonce()
        || command.role() != transcript.role()
    {
        return Err(store_error(
            "tenant-root refresh command and installation evidence do not match",
        ));
    }
    evidence
        .lifecycle_receipt_digest()
        .map_err(|error| store_error(error.message()))
}

pub(super) fn validate_refresh_sealed_binding(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    sealed_binding: &TenantRootOnlineRoleShareBindingV1,
    share_identity_digest: TenantRootIdentityDigestV1,
    evidence_digest: TenantRootLifecycleReceiptDigestV1,
) -> RoleStoreResult<()> {
    let transcript = evidence.evidence().transcript();
    let evidence_commitment =
        MpcPrfShareCommitmentWireV1::new(transcript.commitment().to_bytes().to_vec())
            .map_err(|error| store_error(error.message()))?;
    if share_identity_digest != command.identity_digest()
        || sealed_binding.identity_digest() != share_identity_digest
        || sealed_binding.custody_lineage() != command.custody_lineage()
        || sealed_binding.role() != command.role()
        || sealed_binding.epoch() != command.next_epoch()
        || sealed_binding.share_commitment() != &evidence_commitment
        || sealed_binding.installation_evidence_digest() != evidence_digest
    {
        return Err(store_error(
            "tenant-root refresh sealed share does not match its command and evidence",
        ));
    }
    Ok(())
}

pub(super) fn validate_refresh_record_binding(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> RoleStoreResult<()> {
    let evidence_digest = validate_refresh_command_evidence(command, evidence)?;
    let transcript = evidence.evidence().transcript();
    let evidence_commitment =
        MpcPrfShareCommitmentWireV1::new(transcript.commitment().to_bytes().to_vec())
            .map_err(|error| store_error(error.message()))?;
    let identity_digest = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let expected_role = cloudflare_role_for_protocol(command.role())?;
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = &record.lifecycle else {
        return Err(store_error(
            "tenant-root refresh insertion requires a pending role share",
        ));
    };
    if identity_digest != command.identity_digest()
        || record.custody_lineage != command.custody_lineage()
        || record.epoch != command.next_epoch()
        || record.role != expected_role
        || record.share_commitment != evidence_commitment
        || pending.installation_evidence_digest() != evidence_digest
    {
        return Err(store_error(
            "tenant-root refresh role-share record does not match its command and evidence",
        ));
    }
    record.validate()
}

/// Whether a stored refresh replay row belongs to this command's epoch
/// transition.
pub(super) fn same_refresh_transition(
    stored: &StoredTenantRootCommandReplayV1,
    command: &VerifiedTenantRootRoleRefreshCommandV1,
) -> RoleStoreResult<bool> {
    let Some(state) = stored.refresh_state.as_ref() else {
        return Ok(false);
    };
    let other = TenantRootRoleRefreshCommandV1::decode_canonical_bytes(&state.command_bytes()?)
        .map_err(|error| store_error(error.message()))?;
    Ok(other.identity_digest() == command.identity_digest()
        && other.custody_lineage() == command.custody_lineage()
        && other.current_epoch() == command.current_epoch()
        && other.next_epoch() == command.next_epoch())
}

pub(super) fn validate_refresh_replay_link(
    record: &CloudflareTenantRootRoleShareRecordV1,
    replay_key: &TenantRootCommandReplayKeyV1,
) -> RoleStoreResult<()> {
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = record.lifecycle() else {
        return Err(store_error(
            "tenant-root refresh replay link requires a pending role share",
        ));
    };
    let replay_key_digest = replay_key
        .storage_key_digest()
        .map_err(|error| store_error(error.message()))?;
    if pending.refresh_replay_key_digest() != Some(replay_key_digest) {
        return Err(store_error(
            "tenant-root refresh pending row does not link its exact replay key",
        ));
    }
    Ok(())
}

pub(super) fn validate_refresh_success_receipt_payload(
    evidence: &VerifiedTenantRootSignedShareInstallationEvidenceWireV1,
    receipt: &VerifiedTenantRootCommandSuccessReceiptV1,
) -> RoleStoreResult<()> {
    if receipt.payload_bytes() != evidence.canonical_bytes() {
        return Err(store_error(
            "tenant-root refresh receipt payload does not match its exact evidence wire",
        ));
    }
    Ok(())
}

pub(super) fn validate_reserved_command(
    scope: &TenantRootCommandScopeV1,
    reservation: &ReservedTenantRootCommandV1,
    operation: TenantRootCommandOperationV1,
    operation_name: &'static str,
) -> RoleStoreResult<()> {
    let command_digest = scope
        .command_digest(operation)
        .map_err(|error| store_error(error.message()))?;
    if reservation.key() != scope.key() || reservation.command_digest() != command_digest {
        return Err(store_error(format!(
            "{operation_name} command does not match its authority reservation"
        )));
    }
    Ok(())
}

pub(super) fn decode_stored_terminal_receipt(
    terminal_kind: TenantRootCommandTerminalKindV1,
    receipt_b64u: Option<&str>,
    receipt_digest_hex: Option<&str>,
    terminal_at_ms: Option<i64>,
    key: TenantRootCommandReplayKeyV1,
    command_digest: TenantRootProtocolDigestV1,
) -> RoleStoreResult<DecodedTenantRootCommandTerminalReceiptV1> {
    let receipt_b64u = receipt_b64u
        .ok_or_else(|| store_error("terminal tenant-root command row omitted receipt bytes"))?;
    let receipt_bytes = decode_base64url_bytes_v1("tenant-root command receipt", receipt_b64u)
        .map_err(|error| store_error(error.message()))?;
    if receipt_bytes.is_empty()
        || receipt_bytes.len() > TENANT_ROOT_COMMAND_TERMINAL_RECEIPT_MAX_BYTES_V1
        || encode_base64url_bytes_v1(&receipt_bytes) != receipt_b64u
    {
        return Err(store_error(
            "terminal tenant-root command receipt bytes are malformed",
        ));
    }

    // D1 stores the signed bytes without a role verifier. The receipt consumer
    // verifies Ed25519 with the retained role key after this canonical binding.
    let receipt = TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(&receipt_bytes)
        .map_err(|error| store_error(error.message()))?;
    let canonical_bytes = receipt
        .canonical_bytes()
        .map_err(|error| store_error(error.message()))?;
    if canonical_bytes != receipt_bytes {
        return Err(store_error(
            "terminal tenant-root command receipt bytes are not canonical",
        ));
    }
    if receipt.outcome() != terminal_kind.expected_outcome() {
        return Err(store_error(
            "terminal tenant-root command receipt outcome conflicts with durable status",
        ));
    }
    if receipt.key() != &key {
        return Err(store_error(
            "terminal tenant-root command receipt replay key conflicts with durable state",
        ));
    }
    if receipt.command_digest() != command_digest {
        return Err(store_error(
            "terminal tenant-root command receipt command digest conflicts with durable state",
        ));
    }
    let receipt_digest = TenantRootProtocolDigestV1::from_bytes(decode_lower_hex_fixed::<32>(
        "tenant-root command receipt digest",
        receipt_digest_hex.ok_or_else(|| {
            store_error("terminal tenant-root command row omitted receipt digest")
        })?,
    )?)
    .map_err(|error| store_error(error.message()))?;
    let decoded_receipt_digest = receipt
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if decoded_receipt_digest != receipt_digest {
        return Err(store_error(
            "terminal tenant-root command receipt digest conflicts with durable state",
        ));
    }
    let terminal_at_ms = positive_u64_from_i64(
        "tenant-root command terminal timestamp",
        terminal_at_ms.ok_or_else(|| {
            store_error("terminal tenant-root command row omitted terminal timestamp")
        })?,
    )?;
    if receipt.terminal_at_ms() != terminal_at_ms {
        return Err(store_error(
            "terminal tenant-root command receipt timestamp conflicts with durable state",
        ));
    }

    Ok(DecodedTenantRootCommandTerminalReceiptV1 {
        receipt_bytes,
        receipt_digest,
        terminal_at_ms,
    })
}

pub(super) fn replay_reservation_from_stored(
    stored: &StoredTenantRootCommandReplayV1,
) -> RoleStoreResult<ReservedTenantRootCommandV1> {
    if !matches!(&stored.record, TenantRootCommandReplayRecordV1::Reserved(_)) {
        return Err(store_error(
            "tenant-root replay row is not resumable as a reservation",
        ));
    }
    fresh_reservation_from_stored(stored)
}

pub(super) fn replay_executed_from_stored(
    stored: &StoredTenantRootCommandReplayV1,
) -> RoleStoreResult<ExecutedTenantRootCommandV1> {
    if !matches!(&stored.record, TenantRootCommandReplayRecordV1::Executed(_)) {
        return Err(store_error(
            "tenant-root replay row is not resumable as an executed command",
        ));
    }
    let executed_at_ms = stored.executed_at_ms.ok_or_else(|| {
        store_error("executed tenant-root replay row omitted execution timestamp")
    })?;
    fresh_reservation_from_stored(stored)?
        .checkpoint_executed(executed_at_ms)
        .map_err(|error| store_error(error.message()))
}

pub(super) fn fresh_reservation_from_stored(
    stored: &StoredTenantRootCommandReplayV1,
) -> RoleStoreResult<ReservedTenantRootCommandV1> {
    let key = *stored.record.key();
    let command_digest = stored.record.command_digest();
    match reserve_tenant_root_command_v1(None, key, command_digest, stored.reserved_at_ms)
        .map_err(|error| store_error(error.message()))?
    {
        TenantRootCommandReplayDecisionV1::Execute(reservation) => Ok(reservation),
        _ => Err(store_error(
            "tenant-root replay row could not reconstruct its reservation",
        )),
    }
}

pub(super) fn insert_pending_payload_digest(
    record: &CloudflareTenantRootRoleShareRecordV1,
    expected_revision: i64,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("insert_pending")?;
    push_record_public_payload(&mut bytes, record)?;
    push_command_i64(&mut bytes, expected_revision)?;
    finish_command_payload(bytes)
}

pub(super) fn refresh_insert_pending_payload_digest(
    command: &VerifiedTenantRootRoleRefreshCommandV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
    expected_revision: i64,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let row_payload_digest = insert_pending_payload_digest(record, expected_revision)?;
    let mut bytes = Vec::new();
    push_command_field(
        &mut bytes,
        TENANT_ROOT_REFRESH_INSERT_PENDING_PAYLOAD_DOMAIN_V1,
    )?;
    push_command_field(&mut bytes, command.digest().as_bytes())?;
    push_command_field(&mut bytes, row_payload_digest.as_bytes())?;
    finish_command_payload(bytes)
}

pub(super) fn refresh_admission_operation_digest(
    scope: &TenantRootCommandScopeV1,
    command_digest: TenantRootProtocolDigestV1,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    scope
        .command_digest(TenantRootCommandOperationV1::insert_pending(command_digest))
        .map_err(|error| store_error(error.message()))
}

pub(super) fn activate_initial_payload_digest(
    pending: &CloudflareStoredTenantRootRoleShareV1,
    activation: &CloudflareTenantRootActivationV1,
    updated_at_ms: u64,
    expected_revision: i64,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("activate_initial")?;
    push_record_public_payload(&mut bytes, &pending.record)?;
    push_command_i64(&mut bytes, expected_revision)?;
    push_activation_payload(&mut bytes, activation)?;
    push_command_u64(&mut bytes, updated_at_ms)?;
    finish_command_payload(bytes)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn managed_restore_forward_refresh_payload_digest(
    scope: &TenantRootCommandScopeV1,
    restored_pending: &CloudflareStoredTenantRootRoleShareV1,
    refresh_pending: &CloudflareStoredTenantRootRoleShareV1,
    activation: &CloudflareTenantRootActivationV1,
    capability_digest: TenantRootLifecycleReceiptDigestV1,
    backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    updated_at_ms: u64,
    expected_restored_revision: i64,
    expected_refresh_revision: i64,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("managed_restore_forward_refresh")?;
    let key = scope.key();
    push_command_field(&mut bytes, key.identity_digest().as_bytes())?;
    push_command_field(&mut bytes, key.custody_lineage().as_bytes())?;
    push_command_field(&mut bytes, key.session_id().as_bytes())?;
    push_command_field(&mut bytes, key.nonce().as_bytes())?;
    push_command_field(&mut bytes, key.role().as_str().as_bytes())?;
    push_command_u64(&mut bytes, scope.epoch().get().get())?;
    push_command_u64(&mut bytes, scope.expected_control_plane_revision())?;
    push_record_public_payload(&mut bytes, &restored_pending.record)?;
    push_command_i64(&mut bytes, expected_restored_revision)?;
    push_record_public_payload(&mut bytes, &refresh_pending.record)?;
    push_command_i64(&mut bytes, expected_refresh_revision)?;
    push_activation_payload(&mut bytes, activation)?;
    push_command_field(&mut bytes, capability_digest.as_bytes())?;
    push_command_field(&mut bytes, backup_receipt_digest.as_bytes())?;
    push_command_field(&mut bytes, installation_receipt_digest.as_bytes())?;
    push_command_u64(&mut bytes, updated_at_ms)?;
    finish_command_payload(bytes)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn swap_active_epoch_payload_digest(
    active: &CloudflareStoredTenantRootRoleShareV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
    activation: &CloudflareTenantRootActivationV1,
    retirement: &CloudflareTenantRootRetirementV1,
    updated_at_ms: u64,
    expected_active_revision: i64,
    expected_pending_revision: i64,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("swap_active_epoch")?;
    push_record_public_payload(&mut bytes, &active.record)?;
    push_command_i64(&mut bytes, expected_active_revision)?;
    push_record_public_payload(&mut bytes, &pending.record)?;
    push_command_i64(&mut bytes, expected_pending_revision)?;
    push_activation_payload(&mut bytes, activation)?;
    push_retirement_payload(&mut bytes, retirement)?;
    push_command_u64(&mut bytes, updated_at_ms)?;
    finish_command_payload(bytes)
}

pub(super) fn cleanup_pending_payload_digest(
    pending: &CloudflareStoredTenantRootRoleShareV1,
    expected_revision: i64,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("cleanup_pending")?;
    push_record_public_payload(&mut bytes, &pending.record)?;
    push_command_i64(&mut bytes, expected_revision)?;
    finish_command_payload(bytes)
}

pub(super) fn authorized_cleanup_pending_payload_digest(
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
    expected_revision: i64,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let row_payload_digest = cleanup_pending_payload_digest(pending, expected_revision)?;
    let authorization_digest = authorization
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let mut bytes = Vec::new();
    push_command_field(&mut bytes, TENANT_ROOT_AUTHORIZED_CLEANUP_PAYLOAD_DOMAIN_V1)?;
    push_command_field(&mut bytes, authorization_digest.as_bytes())?;
    push_command_field(&mut bytes, row_payload_digest.as_bytes())?;
    finish_command_payload(bytes)
}

pub(super) fn cleanup_retired_payload_digest(
    retired: &CloudflareStoredTenantRootRoleShareV1,
    expected_retired_revision: i64,
    expected_active_epoch: TenantRootShareEpoch,
    expected_active_revision: i64,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let mut bytes = command_payload_start("cleanup_retired")?;
    push_record_public_payload(&mut bytes, &retired.record)?;
    push_command_i64(&mut bytes, expected_retired_revision)?;
    push_command_u64(&mut bytes, expected_active_epoch.get().get())?;
    push_command_i64(&mut bytes, expected_active_revision)?;
    finish_command_payload(bytes)
}

pub(super) fn authorized_cleanup_retired_payload_digest(
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
    retired: &CloudflareStoredTenantRootRoleShareV1,
    expected_retired_revision: i64,
    expected_active_epoch: TenantRootShareEpoch,
    expected_active_revision: i64,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let row_payload_digest = cleanup_retired_payload_digest(
        retired,
        expected_retired_revision,
        expected_active_epoch,
        expected_active_revision,
    )?;
    let authorization_digest = authorization
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let mut bytes = Vec::new();
    push_command_field(&mut bytes, TENANT_ROOT_AUTHORIZED_CLEANUP_PAYLOAD_DOMAIN_V1)?;
    push_command_field(&mut bytes, authorization_digest.as_bytes())?;
    push_command_field(&mut bytes, row_payload_digest.as_bytes())?;
    finish_command_payload(bytes)
}

pub(super) fn authorized_cleanup_abandoned_ceremony_payload_digest(
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let authorization_digest = authorization
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let mut bytes = command_payload_start("authorized_cleanup_abandoned_ceremony")?;
    push_command_field(&mut bytes, authorization_digest.as_bytes())?;
    finish_command_payload(bytes)
}

pub(super) const TENANT_ROOT_RECOVERY_RETENTION_KEY_D1_HPKE_INFO: &[u8] =
    b"seams/deriver/tenant-root-recovery-retention-key/hpke/v1";

/// A role-store recovery retention key, sealed to the role's own key.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TenantRootRecoveryRetentionKeyCiphertextV1 {
    pub(super) key_version: String,
    pub(super) ciphertext_b64u: String,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct TenantRootAttemptKeyRowV1 {
    pub(super) attempt_key_hex: String,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct TenantRootActiveEpochRowV1 {
    pub(super) tenant_root_share_epoch: i64,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct TenantRootAdmissionCountRowV1 {
    pub(super) admissions: i64,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct TenantRootRootUseAdmissionRowV1 {
    pub(super) tenant_root_share_epoch: i64,
    pub(super) activation_receipt_digest_hex: String,
    pub(super) attempt_digest_hex: String,
    pub(super) status: String,
    pub(super) pair_object_id: Option<String>,
    pub(super) preparation_digest_hex: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct TenantRootCreationTombstoneRowV1 {
    pub(super) session_id_hex: String,
}

pub(super) fn authorized_cleanup_retired_absent_payload_digest(
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    let authorization_digest = authorization
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let mut bytes = command_payload_start("authorized_cleanup_retired_absent")?;
    push_command_field(&mut bytes, authorization_digest.as_bytes())?;
    finish_command_payload(bytes)
}

pub(super) fn validate_authorized_cleanup_pending(
    cipher: &TenantRootRoleD1CipherV1,
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
) -> RoleStoreResult<()> {
    validate_pending_stored_record(cipher, pending)?;
    let record_role = tenant_root_protocol_role_of(pending.record.role);
    let identity_digest = pending
        .record
        .identity()
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let evidence_digest = record_installation_evidence_digest(&pending.record)?;
    if authorization.role() != record_role
        || authorization.identity_digest() != identity_digest
        || authorization.custody_lineage() != pending.record.custody_lineage
        || authorization.epoch() != pending.record.epoch
        || authorization.expected_row_revision() != pending.revision
        || authorization
            .pending_installation_evidence_digest()
            .map_err(|error| store_error(error.message()))?
            .as_bytes()
            != evidence_digest.as_bytes()
    {
        return Err(store_error(
            "tenant-root cleanup authorization does not name the authoritative pending row",
        ));
    }
    Ok(())
}

pub(super) fn validate_authorized_cleanup_retired(
    cipher: &TenantRootRoleD1CipherV1,
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
    retired: &CloudflareStoredTenantRootRoleShareV1,
    active: &CloudflareStoredTenantRootRoleShareV1,
) -> RoleStoreResult<()> {
    validate_retired_stored_record(cipher, retired)?;
    validate_active_stored_record(cipher, active)?;
    let TenantRootRoleCleanupTargetV1::Retired {
        identity_digest,
        custody_lineage,
        role,
        retired_epoch,
        expected_retired_revision,
        expected_active_epoch,
        expected_active_revision,
    } = authorization.target()
    else {
        return Err(store_error(
            "tenant-root retired cleanup requires a retired authorization",
        ));
    };
    let retired_identity = retired
        .record()
        .identity()
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let active_identity = active
        .record()
        .identity()
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let retired_role = tenant_root_protocol_role_of(retired.record().role());
    let active_role = tenant_root_protocol_role_of(active.record().role());
    if retired_identity != *identity_digest
        || active_identity != *identity_digest
        || retired.record().custody_lineage() != *custody_lineage
        || active.record().custody_lineage() != *custody_lineage
        || retired_role != *role
        || active_role != *role
        || retired.record().epoch() != *retired_epoch
        || retired.revision() != *expected_retired_revision
        || active.record().epoch() != *expected_active_epoch
        || active.revision() != *expected_active_revision
        || retired.record().epoch() >= *expected_active_epoch
    {
        return Err(store_error(
            "tenant-root cleanup authorization does not name the authoritative retired row and active successor",
        ));
    }
    Ok(())
}

pub(super) fn validate_authorized_cleanup_retired_absent(
    cipher: &TenantRootRoleD1CipherV1,
    authorization: &VerifiedTenantRootRoleCleanupCommandV1,
    active: &CloudflareStoredTenantRootRoleShareV1,
) -> RoleStoreResult<()> {
    validate_active_stored_record(cipher, active)?;
    let TenantRootRoleCleanupTargetV1::Retired {
        identity_digest,
        custody_lineage,
        role,
        retired_epoch,
        expected_retired_revision,
        expected_active_epoch,
        expected_active_revision,
    } = authorization.target()
    else {
        return Err(store_error(
            "tenant-root absent retired cleanup requires a retired authorization",
        ));
    };
    let active_identity = active
        .record()
        .identity()
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let active_role = tenant_root_protocol_role_of(active.record().role());
    if active_identity != *identity_digest
        || active.record().custody_lineage() != *custody_lineage
        || active_role != *role
        || active.record().epoch() != *expected_active_epoch
        || active.revision() != *expected_active_revision
        || *expected_retired_revision <= 0
        || retired_epoch >= expected_active_epoch
    {
        return Err(store_error(
            "tenant-root absent retired cleanup authorization does not name the active successor",
        ));
    }
    Ok(())
}

pub(super) fn command_payload_start(operation: &'static str) -> RoleStoreResult<Vec<u8>> {
    let mut bytes = Vec::new();
    push_command_field(&mut bytes, TENANT_ROOT_ROLE_COMMAND_PAYLOAD_DOMAIN_V1)?;
    push_command_field(&mut bytes, operation.as_bytes())?;
    Ok(bytes)
}

pub(super) fn finish_command_payload(bytes: Vec<u8>) -> RoleStoreResult<TenantRootProtocolDigestV1> {
    TenantRootProtocolDigestV1::from_bytes(Sha256::digest(bytes).into())
        .map_err(|error| store_error(error.message()))
}

pub(super) fn push_record_public_payload(
    bytes: &mut Vec<u8>,
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> RoleStoreResult<()> {
    record.validate()?;
    let identity_digest = record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    push_command_field(bytes, identity_digest.as_bytes())?;
    push_command_field(bytes, record.custody_lineage.as_bytes())?;
    push_command_u64(bytes, record.epoch.get().get())?;
    push_command_field(bytes, record.role.as_str().as_bytes())?;
    push_command_field(
        bytes,
        record.sealed_share.ciphertext_digest_hex().as_bytes(),
    )?;
    push_command_field(bytes, record.share_commitment.as_bytes())?;
    push_command_field(bytes, record.epoch_wrapping_key_ref.as_bytes())?;
    push_lifecycle_public_payload(bytes, &record.lifecycle)?;
    push_command_u64(bytes, record.created_at_ms)?;
    push_command_u64(bytes, record.updated_at_ms)?;
    Ok(())
}

pub(super) fn push_lifecycle_public_payload(
    bytes: &mut Vec<u8>,
    lifecycle: &CloudflareTenantRootRoleShareLifecycleV1,
) -> RoleStoreResult<()> {
    match lifecycle {
        CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => {
            push_command_field(bytes, b"pending")?;
            push_pending_public_payload(bytes, pending)?;
        }
        CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
            push_command_field(bytes, b"active")?;
            push_active_public_payload(bytes, active)?;
        }
        CloudflareTenantRootRoleShareLifecycleV1::Retired(retired) => {
            push_command_field(bytes, b"retired")?;
            push_retired_public_payload(bytes, retired)?;
        }
    }
    Ok(())
}

pub(super) fn push_pending_public_payload(
    bytes: &mut Vec<u8>,
    pending: &CloudflareTenantRootPendingShareV1,
) -> RoleStoreResult<()> {
    push_command_field(bytes, pending.installation_evidence_digest.as_bytes())?;
    push_command_u64(bytes, pending.staged_at_ms)?;
    match &pending.origin {
        CloudflareTenantRootPendingShareOriginV1::Ceremony => {
            push_command_field(bytes, b"ceremony")?;
        }
        CloudflareTenantRootPendingShareOriginV1::Refresh { replay_key_digest } => {
            push_command_field(bytes, b"refresh")?;
            push_command_field(bytes, replay_key_digest.as_bytes())?;
        }
        CloudflareTenantRootPendingShareOriginV1::ManagedRestore {
            capability_digest,
            backup_receipt_digest,
        } => {
            push_command_field(bytes, b"managed_restore")?;
            push_command_field(bytes, capability_digest.as_bytes())?;
            push_command_field(bytes, backup_receipt_digest.as_bytes())?;
        }
    }
    Ok(())
}

pub(super) fn push_active_public_payload(
    bytes: &mut Vec<u8>,
    active: &CloudflareTenantRootActiveShareV1,
) -> RoleStoreResult<()> {
    push_pending_public_payload(bytes, &active.pending)?;
    push_activation_payload(bytes, &active.activation)
}

pub(super) fn push_retired_public_payload(
    bytes: &mut Vec<u8>,
    retired: &CloudflareTenantRootRetiredShareV1,
) -> RoleStoreResult<()> {
    push_active_public_payload(bytes, &retired.active)?;
    push_retirement_payload(bytes, &retired.retirement)
}

pub(super) fn push_activation_payload(
    bytes: &mut Vec<u8>,
    activation: &CloudflareTenantRootActivationV1,
) -> RoleStoreResult<()> {
    activation.validate()?;
    match &activation.availability {
        CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            role_backup_receipt_digest,
            identity_digest,
            custody_lineage,
            role,
            epoch,
            share_commitment,
        } => {
            push_command_field(bytes, b"current_role_backup")?;
            push_command_field(bytes, role_backup_receipt_digest.as_bytes())?;
            push_command_field(bytes, identity_digest.as_bytes())?;
            push_command_field(bytes, custody_lineage.as_bytes())?;
            push_command_field(bytes, managed_restore_role_str(*role).as_bytes())?;
            push_command_u64(bytes, epoch.get().get())?;
            push_command_field(bytes, share_commitment.as_bytes())?;
        }
        CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
            authorization_digest,
            identity_digest,
            custody_lineage,
            role,
            epoch,
            share_commitment,
        } => {
            push_command_field(bytes, b"accepted_permanent_derivation_loss")?;
            push_command_field(bytes, authorization_digest.as_bytes())?;
            push_command_field(bytes, identity_digest.as_bytes())?;
            push_command_field(bytes, custody_lineage.as_bytes())?;
            push_command_field(bytes, managed_restore_role_str(*role).as_bytes())?;
            push_command_u64(bytes, epoch.get().get())?;
            push_command_field(bytes, share_commitment.as_bytes())?;
        }
        CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal { provenance } => {
            push_command_field(bytes, b"tenant_held_external")?;
            push_command_field(bytes, provenance.identity_digest().as_bytes())?;
            push_command_field(bytes, provenance.custody_lineage().as_bytes())?;
            push_command_field(bytes, provenance.destination_fingerprint().as_bytes())?;
            push_command_field(bytes, provenance.restore_session_id().as_bytes())?;
            push_command_field(bytes, provenance.recovery_set_id().as_bytes())?;
            push_command_field(bytes, provenance.manifest_digest())?;
            push_command_field(
                bytes,
                provenance.deriver_a_acceptance_receipt_digest().as_bytes(),
            )?;
            push_command_field(
                bytes,
                provenance.deriver_b_acceptance_receipt_digest().as_bytes(),
            )?;
            push_command_field(bytes, provenance.deriver_a_imported_commitment().as_bytes())?;
            push_command_field(bytes, provenance.deriver_b_imported_commitment().as_bytes())?;
            push_command_field(bytes, provenance.stable_root_commitment())?;
            push_command_field(bytes, provenance.restore_context_digest().as_bytes())?;
            push_command_field(
                bytes,
                provenance.restore_refresh_command_digest().as_bytes(),
            )?;
        }
    }
    push_command_field(bytes, &activation.activation_receipt_bytes)?;
    push_command_u64(bytes, activation.activated_at_ms)
}

pub(super) const fn managed_restore_role_str(role: TenantRootManagedRestoreRoleV1) -> &'static str {
    match role {
        TenantRootManagedRestoreRoleV1::DeriverA => "deriver_a",
        TenantRootManagedRestoreRoleV1::DeriverB => "deriver_b",
    }
}

pub(super) fn push_retirement_payload(
    bytes: &mut Vec<u8>,
    retirement: &CloudflareTenantRootRetirementV1,
) -> RoleStoreResult<()> {
    push_command_field(bytes, retirement.retirement_receipt_digest.as_bytes())?;
    push_command_u64(bytes, retirement.retired_at_ms)
}

pub(super) fn push_command_u64(bytes: &mut Vec<u8>, value: u64) -> RoleStoreResult<()> {
    push_command_field(bytes, &value.to_be_bytes())
}

pub(super) fn push_command_i64(bytes: &mut Vec<u8>, value: i64) -> RoleStoreResult<()> {
    let value = u64::try_from(value)
        .map_err(|_| store_error("tenant-root command local revision is invalid"))?;
    push_command_u64(bytes, value)
}

pub(super) fn push_command_field(bytes: &mut Vec<u8>, value: &[u8]) -> RoleStoreResult<()> {
    let length = u32::try_from(value.len())
        .map_err(|_| store_error("tenant-root command payload field is too long"))?;
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes.extend_from_slice(value);
    Ok(())
}

pub(super) fn identity_digest_hex(identity: &TenantRootIdentityV1) -> RoleStoreResult<String> {
    identity
        .digest()
        .map(|digest| encode_hex(digest.as_bytes()))
        .map_err(|error| store_error(error.message()))
}

pub(super) fn active_binding_from_stored(
    stored: &CloudflareStoredTenantRootRoleShareV1,
) -> RoleStoreResult<TenantRootActiveRoleBindingV1> {
    validate_active_stored_record_shape(stored)?;
    let record = stored.record();
    let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = record.lifecycle() else {
        return Err(store_error(
            "tenant-root active binding requires an active record",
        ));
    };
    let identity_digest = record
        .identity()
        .digest()
        .map_err(|error| store_error(error.message()))?;
    let row = TenantRootActiveRoleRowKeyV1::new(
        identity_digest,
        record.custody_lineage(),
        record.epoch(),
        record.role().managed_restore_role(),
    );
    TenantRootActiveRoleBindingV1::new(
        row,
        record.share_commitment().clone(),
        active.activation.activation_receipt_digest,
    )
    .map_err(|error| store_error(error.message()))
}

pub(super) fn required_reader_var(
    env: &impl crate::CloudflareEnvReaderV1,
    name: &'static str,
) -> RoleStoreResult<String> {
    let value = env
        .get_text(name)
        .map_err(|error| store_error(format!("required env {name} is unavailable: {}", error.message())))?
        .ok_or_else(|| store_error(format!("required env {name} is unavailable")))?;
    require_identifier(name, &value)?;
    Ok(value)
}

pub(super) fn require_identifier(field: &str, value: &str) -> RoleStoreResult<()> {
    if value.is_empty()
        || value.trim() != value
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(store_error(format!("{field} is malformed")));
    }
    Ok(())
}

pub(super) fn require_digest_hex(field: &str, value: &str) -> RoleStoreResult<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(store_error(format!(
            "{field} must be 32-byte lowercase hex"
        )));
    }
    Ok(())
}

pub(super) fn require_nonzero_bytes(field: &'static str, value: &[u8]) -> RoleStoreResult<()> {
    if value.iter().all(|byte| *byte == 0) {
        return Err(store_error(format!("{field} must be non-zero")));
    }
    Ok(())
}

pub(super) fn require_timestamp(field: &str, value: u64) -> RoleStoreResult<()> {
    if value == 0 {
        return Err(store_error(format!("{field} must be positive")));
    }
    timestamp_i64(value).map(|_| ())
}

pub(super) fn timestamp_i64(value: u64) -> RoleStoreResult<i64> {
    i64::try_from(value).map_err(|_| store_error("tenant-root timestamp exceeds D1 INTEGER"))
}

pub(super) fn epoch_i64(epoch: TenantRootShareEpoch) -> RoleStoreResult<i64> {
    epoch_i64_value(epoch.get().get())
}

pub(super) fn epoch_i64_value(epoch: u64) -> RoleStoreResult<i64> {
    i64::try_from(epoch).map_err(|_| store_error("tenant-root share epoch exceeds D1 INTEGER"))
}

pub(super) fn decode_private_key(encoded: &str) -> RoleStoreResult<[u8; 32]> {
    let hex = encoded
        .trim()
        .strip_prefix(ROLE_PRIVATE_D1_KEK_SECRET_PREFIX)
        .ok_or_else(|| {
            store_error("role-private D1 KEK Secret has an unsupported encoding prefix")
        })?;
    if hex.len() != 64 {
        return Err(store_error(
            "role-private D1 KEK Secret must contain 32 bytes",
        ));
    }
    let mut bytes = [0_u8; 32];
    for (index, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        let high = decode_hex_nibble(chunk[0])
            .ok_or_else(|| store_error("role-private D1 KEK Secret must use lowercase hex"))?;
        let low = decode_hex_nibble(chunk[1])
            .ok_or_else(|| store_error("role-private D1 KEK Secret must use lowercase hex"))?;
        bytes[index] = (high << 4) | low;
    }
    Ok(bytes)
}

pub(super) const fn decode_hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

pub(super) fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(test)]
pub(super) fn lifecycle_receipt(seed: u8) -> RoleStoreResult<TenantRootLifecycleReceiptDigestV1> {
    TenantRootLifecycleReceiptDigestV1::from_bytes([seed; 32])
        .map_err(|error| store_error(error.message()))
}

pub(super) fn decode_lower_hex_fixed<const N: usize>(field: &str, value: &str) -> RoleStoreResult<[u8; N]> {
    if value.len() != N * 2 {
        return Err(store_error(format!(
            "{field} must contain exactly {N} bytes of lowercase hex"
        )));
    }
    let mut bytes = [0_u8; N];
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = decode_hex_nibble(chunk[0])
            .ok_or_else(|| store_error(format!("{field} must use lowercase hex")))?;
        let low = decode_hex_nibble(chunk[1])
            .ok_or_else(|| store_error(format!("{field} must use lowercase hex")))?;
        bytes[index] = (high << 4) | low;
    }
    Ok(bytes)
}

pub(super) fn decode_base64url_fixed<const N: usize>(field: &str, value: &str) -> RoleStoreResult<[u8; N]> {
    let bytes =
        decode_base64url_bytes_v1(field, value).map_err(|error| store_error(error.message()))?;
    if encode_base64url_bytes_v1(&bytes) != value || bytes.len() != N {
        return Err(store_error(format!(
            "{field} must contain exactly {N} canonical base64url bytes"
        )));
    }
    bytes
        .try_into()
        .map_err(|_| store_error(format!("{field} has an invalid fixed length")))
}

pub(super) fn positive_u64_from_i64(field: &str, value: i64) -> RoleStoreResult<u64> {
    let value = u64::try_from(value).map_err(|_| store_error(format!("{field} is invalid")))?;
    if value == 0 {
        return Err(store_error(format!("{field} must be positive")));
    }
    Ok(value)
}

pub(super) fn require_receipt_digest(
    receipt_bytes: &[u8],
    expected: TenantRootProtocolDigestV1,
) -> RoleStoreResult<()> {
    let actual: [u8; 32] = Sha256::digest(receipt_bytes).into();
    if &actual != expected.as_bytes() {
        return Err(store_error(
            "tenant-root command replay receipt digest does not match its bytes",
        ));
    }
    Ok(())
}

pub(super) fn validate_active_stored_record_shape(
    stored: &CloudflareStoredTenantRootRoleShareV1,
) -> RoleStoreResult<()> {
    stored.record.validate()?;
    let CloudflareTenantRootRoleShareLifecycleV1::Active(_) = &stored.record.lifecycle else {
        return Err(store_error(
            "tenant-root role-private operation requires an active record",
        ));
    };
    validate_record_activation_binding(&stored.record)?;
    if stored.revision <= 0 {
        return Err(store_error(
            "tenant-root role-private revision must be positive",
        ));
    }
    Ok(())
}

pub(super) fn validate_record_activation_binding(
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> RoleStoreResult<()> {
    match &record.lifecycle {
        CloudflareTenantRootRoleShareLifecycleV1::Pending(_) => Ok(()),
        CloudflareTenantRootRoleShareLifecycleV1::Active(active) => {
            active.activation.validate_for_record(record)
        }
        CloudflareTenantRootRoleShareLifecycleV1::Retired(retired) => {
            retired.active.activation.validate_for_record(record)
        }
    }
}

pub(super) fn validate_pending_stored_record(
    cipher: &TenantRootRoleD1CipherV1,
    stored: &CloudflareStoredTenantRootRoleShareV1,
) -> RoleStoreResult<()> {
    stored.record.validate()?;
    cipher.require_role(stored.record.role)?;
    if !matches!(
        stored.record.lifecycle,
        CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
    ) {
        return Err(store_error(
            "tenant-root role-private operation requires a pending record",
        ));
    }
    if stored.revision <= 0 {
        return Err(store_error(
            "tenant-root role-private revision must be positive",
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn validate_managed_restore_forward_refresh_source(
    cipher: &TenantRootRoleD1CipherV1,
    stored: &CloudflareStoredTenantRootRoleShareV1,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    current_epoch: TenantRootShareEpoch,
    capability_digest: TenantRootLifecycleReceiptDigestV1,
    backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
) -> RoleStoreResult<()> {
    validate_pending_stored_record(cipher, stored)?;
    let record_identity_digest = stored
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if record_identity_digest != identity_digest
        || stored.record.custody_lineage != custody_lineage
        || stored.record.epoch != current_epoch
    {
        return Err(store_error(
            "managed-restore forward-refresh source coordinates do not match its request",
        ));
    }
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = &stored.record.lifecycle
    else {
        unreachable!("pending lifecycle was checked by validate_pending_stored_record");
    };
    let Some((stored_capability_digest, stored_backup_receipt_digest)) =
        pending.managed_restore_digests()
    else {
        return Err(store_error(
            "managed-restore forward-refresh source is not restored material",
        ));
    };
    if stored_capability_digest != capability_digest
        || stored_backup_receipt_digest != backup_receipt_digest
    {
        return Err(store_error(
            "managed-restore forward-refresh source provenance does not match its request",
        ));
    }
    if pending.installation_evidence_digest() != installation_receipt_digest {
        return Err(store_error(
            "managed-restore forward-refresh source installation evidence does not match its request",
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn validate_managed_restore_forward_refresh_inputs(
    cipher: &TenantRootRoleD1CipherV1,
    scope: &TenantRootCommandScopeV1,
    restored_pending: &CloudflareStoredTenantRootRoleShareV1,
    refresh_pending: &CloudflareStoredTenantRootRoleShareV1,
    activation: &CloudflareTenantRootActivationV1,
    capability_digest: TenantRootLifecycleReceiptDigestV1,
    backup_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    installation_receipt_digest: TenantRootLifecycleReceiptDigestV1,
    updated_at_ms: u64,
) -> RoleStoreResult<()> {
    validate_pending_stored_record(cipher, restored_pending)?;
    validate_pending_stored_record(cipher, refresh_pending)?;

    let restored_identity_digest = restored_pending
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    validate_managed_restore_forward_refresh_source(
        cipher,
        restored_pending,
        restored_identity_digest,
        restored_pending.record.custody_lineage,
        restored_pending.record.epoch,
        capability_digest,
        backup_receipt_digest,
        installation_receipt_digest,
    )?;

    validate_epoch_swap_inputs(restored_pending, refresh_pending)?;
    let refresh_identity_digest = refresh_pending
        .record
        .identity
        .digest()
        .map_err(|error| store_error(error.message()))?;
    if refresh_identity_digest != restored_identity_digest {
        return Err(store_error(
            "managed-restore forward refresh requires one tenant-root identity",
        ));
    }
    validate_command_scope_for_record(
        scope,
        &refresh_pending.record,
        refresh_pending.revision,
        "managed-restore forward refresh",
    )?;
    validate_activation_receipt_against_swap_records(
        activation,
        restored_pending,
        refresh_pending,
    )?;
    refresh_pending
        .record
        .clone()
        .into_active(activation.clone(), updated_at_ms)?;
    Ok(())
}

pub(super) fn validate_retired_stored_record(
    cipher: &TenantRootRoleD1CipherV1,
    stored: &CloudflareStoredTenantRootRoleShareV1,
) -> RoleStoreResult<()> {
    stored.record.validate()?;
    cipher.require_role(stored.record.role)?;
    if !matches!(
        stored.record.lifecycle,
        CloudflareTenantRootRoleShareLifecycleV1::Retired(_)
    ) {
        return Err(store_error(
            "tenant-root role-private operation requires a retired record",
        ));
    }
    validate_record_activation_binding(&stored.record)?;
    if stored.revision <= 0 {
        return Err(store_error(
            "tenant-root role-private revision must be positive",
        ));
    }
    Ok(())
}

pub(super) fn validate_managed_restore_staging_record(
    record: &CloudflareTenantRootRoleShareRecordV1,
    capability_digest: TenantRootLifecycleReceiptDigestV1,
) -> RoleStoreResult<()> {
    record.validate()?;
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = record.lifecycle() else {
        return Err(store_error(
            "managed-restore material must be stored as a pending role-share record",
        ));
    };
    let Some((stored_capability_digest, _)) = pending.managed_restore_digests() else {
        return Err(store_error(
            "managed-restore staging record is missing restore provenance",
        ));
    };
    if stored_capability_digest != capability_digest {
        return Err(store_error(
            "managed-restore staging record capability digest does not match its input",
        ));
    }
    Ok(())
}

pub(super) fn validate_active_stored_record(
    cipher: &TenantRootRoleD1CipherV1,
    stored: &CloudflareStoredTenantRootRoleShareV1,
) -> RoleStoreResult<()> {
    validate_active_stored_record_shape(stored)?;
    cipher.require_role(stored.record.role)?;
    Ok(())
}

pub(super) fn require_lifecycle_progression(
    operation: &'static str,
    existing_updated_at_ms: u64,
    event_at_ms: u64,
    updated_at_ms: u64,
) -> RoleStoreResult<()> {
    if event_at_ms < existing_updated_at_ms || updated_at_ms < existing_updated_at_ms {
        return Err(store_error(format!(
            "{operation} timestamps regress the existing tenant-root record"
        )));
    }
    if event_at_ms > updated_at_ms {
        return Err(store_error(format!(
            "{operation} timestamp exceeds the tenant-root record update timestamp"
        )));
    }
    Ok(())
}

pub(super) fn validate_epoch_swap_inputs(
    active: &CloudflareStoredTenantRootRoleShareV1,
    pending: &CloudflareStoredTenantRootRoleShareV1,
) -> RoleStoreResult<()> {
    if active.record.identity != pending.record.identity {
        return Err(store_error(
            "tenant-root epoch swap requires one tenant-root identity",
        ));
    }
    if active.record.custody_lineage != pending.record.custody_lineage {
        return Err(store_error(
            "tenant-root epoch swap requires one custody lineage",
        ));
    }
    if active.record.role != pending.record.role {
        return Err(store_error(
            "tenant-root epoch swap requires one Deriver role",
        ));
    }
    if active
        .record
        .epoch
        .next()
        .map_err(|error| store_error(error.message()))?
        != pending.record.epoch
    {
        return Err(store_error(
            "tenant-root epoch swap must advance exactly one epoch",
        ));
    }
    Ok(())
}

pub(super) fn next_revision(revision: i64) -> RoleStoreResult<i64> {
    if revision <= 0 {
        return Err(store_error(
            "tenant-root role-private revision must be positive",
        ));
    }
    revision
        .checked_add(1)
        .ok_or_else(|| store_error("tenant-root role-private revision is exhausted"))
}

pub(super) fn result_changes(result: &impl RoleSqlOutcomeV1) -> RoleStoreResult<usize> {
    result.changes()
}

pub(super) fn require_changes(
    result: &impl RoleSqlOutcomeV1,
    expected: usize,
    message: &'static str,
) -> RoleStoreResult<()> {
    if result_changes(result)? != expected {
        return Err(store_error(message));
    }
    Ok(())
}

pub(super) fn require_one_change(result: &impl RoleSqlOutcomeV1, message: &'static str) -> RoleStoreResult<()> {
    require_changes(result, 1, message)
}

pub(super) fn store_error(message: impl Into<String>) -> RoleStoreError {
    RoleStoreError::message(message.into())
}
