//! Role, scope and provider helpers, and the Deriver restore import-key, accept and status handlers.

use super::*;

pub(super) fn tenant_root_creation_protocol_role_v1(
    worker_role: crate::CloudflareWorkerRoleV1,
) -> RouterAbProtocolResult<TwoPartyDeriverRole> {
    match worker_role {
        crate::CloudflareWorkerRoleV1::DeriverA => Ok(TwoPartyDeriverRole::DeriverA),
        crate::CloudflareWorkerRoleV1::DeriverB => Ok(TwoPartyDeriverRole::DeriverB),
        crate::CloudflareWorkerRoleV1::Router
        | crate::CloudflareWorkerRoleV1::SigningWorker
        | crate::CloudflareWorkerRoleV1::TenantRootControlPlane => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "only a Deriver may execute tenant-root role creation",
        )),
    }
}

pub(super) fn tenant_root_managed_restore_role_v1(
    role: TwoPartyDeriverRole,
) -> TenantRootManagedRestoreRoleV1 {
    match role {
        TwoPartyDeriverRole::DeriverA => TenantRootManagedRestoreRoleV1::DeriverA,
        TwoPartyDeriverRole::DeriverB => TenantRootManagedRestoreRoleV1::DeriverB,
    }
}

pub(super) const fn tenant_root_protocol_role_for_managed_restore_v1(
    role: TenantRootManagedRestoreRoleV1,
) -> TwoPartyDeriverRole {
    match role {
        TenantRootManagedRestoreRoleV1::DeriverA => TwoPartyDeriverRole::DeriverA,
        TenantRootManagedRestoreRoleV1::DeriverB => TwoPartyDeriverRole::DeriverB,
    }
}

pub(super) fn tenant_root_managed_restore_staging_scope_v1(
    public_state: &VerifiedTenantRootManagedRestoreRoleUnavailableV1,
    capability: &VerifiedTenantRootManagedRestoreCapabilityV1,
) -> RouterAbProtocolResult<TenantRootCommandScopeV1> {
    const DOMAIN: &[u8] = b"seams/tenant-root/managed-restore-staging-scope/v1";

    let role = tenant_root_protocol_role_for_managed_restore_v1(capability.role());
    let mut material = Vec::with_capacity(32 + 32 + 32 + 16 + 8 + 8 + 1);
    material.extend_from_slice(DOMAIN);
    material.extend_from_slice(public_state.digest().as_bytes());
    material.extend_from_slice(capability.digest().as_bytes());
    material.extend_from_slice(capability.identity_digest().as_bytes());
    material.extend_from_slice(capability.custody_lineage().as_bytes());
    material.extend_from_slice(&capability.epoch().get().get().to_be_bytes());
    material.extend_from_slice(&public_state.lifecycle_revision().to_be_bytes());
    material.push(match role {
        TwoPartyDeriverRole::DeriverA => 1,
        TwoPartyDeriverRole::DeriverB => 2,
    });

    let mut session_material = material.clone();
    session_material.extend_from_slice(b"/session");
    let session_id = TenantRootCeremonySessionIdV1::from_bytes(
        Sha256::digest(&session_material)[..16]
            .try_into()
            .map_err(|_| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    "tenant-root managed-restore staging session digest has an invalid length",
                )
            })?,
    )
    .map_err(candidate_derivation_error)?;

    material.extend_from_slice(b"/nonce");
    let nonce = TenantRootCeremonyNonceV1::from_bytes(Sha256::digest(&material).into())
        .map_err(candidate_derivation_error)?;
    let key = TenantRootCommandReplayKeyV1::new(
        capability.identity_digest(),
        capability.custody_lineage(),
        session_id,
        nonce,
        role,
    );
    TenantRootCommandScopeV1::new(key, capability.epoch(), public_state.lifecycle_revision())
        .map_err(candidate_derivation_error)
}

pub(super) fn tenant_root_creation_package_authority_v1(
    creation_state: &impl TenantRootCreationStateTransportV1,
    package_bytes: &[u8],
) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
    let package = TenantRootRoleCreationCommandPackageV1::decode_canonical_bytes(package_bytes)
        .map_err(candidate_derivation_error)?;
    let context = package
        .creation_context()
        .map_err(candidate_derivation_error)?;
    creation_state.creation_authority_id(context.identity_digest(), context.custody_lineage())
}

pub(super) fn tenant_root_role_runtime_provider_config_v1(
    worker_role: crate::CloudflareWorkerRoleV1,
    reader: &impl crate::CloudflareEnvReaderV1,
) -> RouterAbProtocolResult<TenantRootRoleRuntimeProviderConfigV1> {
    let config = crate::env::parse_cloudflare_tenant_root_operational_rotation_provider_config_v1(
        worker_role,
        reader,
    )?;
    TenantRootRoleRuntimeProviderConfigV1::new(
        config.online_epoch_wrapping_key_ref(),
        config.backup_provider_id(),
        config.backup_key_version(),
    )
    .map_err(candidate_derivation_error)
}

pub(super) fn tenant_root_store_error_v1(
    operation: &'static str,
    error: impl core::fmt::Display,
) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!("{operation} failed: {error}"),
    )
}

#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(super) fn decode_exact_tenant_root_status_digest_v1(
    field: &'static str,
    encoded: &str,
) -> RouterAbProtocolResult<[u8; 32]> {
    let bytes = crate::decode_base64url_bytes_v1(field, encoded)?;
    if crate::encode_base64url_bytes_v1(&bytes) != encoded {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{field} must use canonical unpadded base64url"),
        ));
    }
    bytes.try_into().map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("{field} must contain exactly 32 bytes"),
        )
    })
}

pub(super) const TENANT_ROOT_RESTORE_IMPORT_REPLAY_KEY_DOMAIN_V1: &[u8] =
    b"seams/tenant-root/restore-import-replay-key/v1";

pub(super) fn update_restore_import_replay_field_v1(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u32).to_be_bytes());
    hasher.update(bytes);
}

pub(super) fn update_restore_import_replay_u64_v1(hasher: &mut Sha256, value: u64) {
    hasher.update(value.to_be_bytes());
}

/// Computes the stable semantic replay key for one verified command.
///
/// The issuer key id and signature are intentionally absent. Every other
/// command field is included, so a re-signature can replay the original row
/// while a changed authorized scope selects a different command.
pub(super) fn tenant_root_restore_import_replay_key_digest_v1(
    command: &VerifiedTenantRootRestoreRoleImportCommandV1,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(TENANT_ROOT_RESTORE_IMPORT_REPLAY_KEY_DOMAIN_V1);
    update_restore_import_replay_field_v1(&mut hasher, command.operation_digest().as_bytes());
    update_restore_import_replay_field_v1(&mut hasher, command.grant_digest().as_bytes());
    update_restore_import_replay_field_v1(
        &mut hasher,
        command.destination_identity_digest().as_bytes(),
    );
    update_restore_import_replay_field_v1(&mut hasher, command.source_custody_lineage().as_bytes());
    update_restore_import_replay_field_v1(
        &mut hasher,
        command.destination_fingerprint().as_bytes(),
    );
    update_restore_import_replay_field_v1(&mut hasher, command.destination_lineage().as_bytes());
    update_restore_import_replay_field_v1(&mut hasher, command.restore_session_id().as_bytes());
    update_restore_import_replay_field_v1(&mut hasher, command.manifest_digest());
    update_restore_import_replay_field_v1(&mut hasher, command.recovery_set_id().as_bytes());
    update_restore_import_replay_field_v1(
        &mut hasher,
        &[match command.role() {
            TwoPartyDeriverRole::DeriverA => 1,
            TwoPartyDeriverRole::DeriverB => 2,
        }],
    );
    update_restore_import_replay_field_v1(
        &mut hasher,
        &command.share_id().get().get().to_be_bytes(),
    );
    update_restore_import_replay_field_v1(&mut hasher, command.source_package_digest().as_bytes());
    let stable_root_commitment = command.stable_root_commitment().to_bytes();
    update_restore_import_replay_field_v1(&mut hasher, &stable_root_commitment);
    update_restore_import_replay_field_v1(
        &mut hasher,
        &command.recovery_share_commitment().to_bytes(),
    );
    update_restore_import_replay_field_v1(&mut hasher, command.recipient_public_key().as_bytes());
    update_restore_import_replay_field_v1(&mut hasher, command.recipient_fingerprint().as_bytes());
    update_restore_import_replay_field_v1(&mut hasher, command.deriver_signing_key_id().as_bytes());
    update_restore_import_replay_field_v1(&mut hasher, command.import_key_id().as_bytes());
    update_restore_import_replay_u64_v1(&mut hasher, command.generation());
    update_restore_import_replay_field_v1(&mut hasher, command.nonce().as_bytes());
    update_restore_import_replay_u64_v1(&mut hasher, command.issued_at_ms());
    update_restore_import_replay_u64_v1(&mut hasher, command.expires_at_ms());
    hasher.finalize().into()
}

pub(super) fn restore_import_binding_matches_command_v1(
    binding: &CloudflareTenantRootRestoreImportKeyBindingV1,
    command: &VerifiedTenantRootRestoreRoleImportCommandV1,
    role: CloudflareTenantRootDeriverRoleV1,
    replay_key_digest: &[u8; 32],
) -> bool {
    let stable_root_commitment = command.stable_root_commitment().to_bytes();
    let share_commitment = command.recovery_share_commitment().to_bytes();
    binding.identity_digest() == command.destination_identity_digest()
        && binding.custody_lineage() == command.destination_lineage()
        && binding.restore_session_id() == command.restore_session_id()
        && binding.recovery_set_id() == command.recovery_set_id()
        && binding.destination_fingerprint() == command.destination_fingerprint()
        && binding.manifest_digest() == command.manifest_digest()
        && binding.stable_root_commitment() == &stable_root_commitment
        && binding.share_commitment() == &share_commitment
        && binding.role() == role
        && binding.generation() == command.generation()
        && binding.import_key_id() == command.import_key_id()
        && binding.replay_key_digest() == replay_key_digest
        && binding.operation_digest() == command.operation_digest().as_bytes()
        && binding.issued_at_ms() == command.issued_at_ms()
        && Some(binding.expires_at_ms())
            == command
                .issued_at_ms()
                .checked_add(router_ab_core::TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1 as u64)
}

pub(super) fn restore_import_key_response_v1(
    record: &CloudflareTenantRootRestoreImportKeyRecordV1,
) -> CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1 {
    let binding = record.binding();
    CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1 {
        role: match binding.role() {
            CloudflareTenantRootDeriverRoleV1::DeriverA => {
                CloudflareTenantRootCreateRoleV1::DeriverA
            }
            CloudflareTenantRootDeriverRoleV1::DeriverB => {
                CloudflareTenantRootCreateRoleV1::DeriverB
            }
        },
        import_key_id: binding.import_key_id().to_owned(),
        import_public_key_b64u: crate::encode_base64url_bytes_v1(
            binding.import_public_key().as_bytes(),
        ),
        generation: binding.generation(),
        issued_at_ms: binding.issued_at_ms(),
        expires_at_ms: binding.expires_at_ms(),
        operation_digest_b64u: crate::encode_base64url_bytes_v1(binding.operation_digest()),
        command_digest_b64u: crate::encode_base64url_bytes_v1(binding.command_digest()),
    }
}

pub(super) const TENANT_ROOT_RESTORE_IMPORT_ACCEPT_RECEIPT_DOMAIN_V1: &[u8] =
    b"seams/tenant-root/restore-import-staged-acceptance/v1";

pub(super) fn tenant_root_restore_import_accept_receipt_digest_v1(
    record: &CloudflareTenantRootRestoreImportKeyRecordV1,
    envelope_digest: &[u8; 32],
) -> [u8; 32] {
    let binding = record.binding();
    let mut hasher = Sha256::new();
    hasher.update(TENANT_ROOT_RESTORE_IMPORT_ACCEPT_RECEIPT_DOMAIN_V1);
    update_restore_import_replay_field_v1(&mut hasher, binding.identity_digest().as_bytes());
    update_restore_import_replay_field_v1(&mut hasher, binding.custody_lineage().as_bytes());
    update_restore_import_replay_field_v1(&mut hasher, binding.restore_session_id().as_bytes());
    update_restore_import_replay_field_v1(
        &mut hasher,
        &[match binding.role() {
            CloudflareTenantRootDeriverRoleV1::DeriverA => 1,
            CloudflareTenantRootDeriverRoleV1::DeriverB => 2,
        }],
    );
    update_restore_import_replay_u64_v1(&mut hasher, binding.generation());
    update_restore_import_replay_field_v1(&mut hasher, binding.import_key_id().as_bytes());
    update_restore_import_replay_field_v1(&mut hasher, binding.operation_digest());
    update_restore_import_replay_field_v1(&mut hasher, binding.share_commitment());
    update_restore_import_replay_field_v1(&mut hasher, envelope_digest);
    hasher.finalize().into()
}

pub(super) fn restore_import_accept_response_v1(
    record: &CloudflareTenantRootRestoreImportKeyRecordV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1> {
    let envelope_digest = record.envelope_digest().ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root restore imported share row has no envelope digest",
        )
    })?;
    let receipt_digest = record.receipt_digest().ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root restore imported share row has no receipt digest",
        )
    })?;
    Ok(
        CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1 {
            role: match record.binding().role() {
                CloudflareTenantRootDeriverRoleV1::DeriverA => {
                    CloudflareTenantRootCreateRoleV1::DeriverA
                }
                CloudflareTenantRootDeriverRoleV1::DeriverB => {
                    CloudflareTenantRootCreateRoleV1::DeriverB
                }
            },
            import_key_id: record.binding().import_key_id().to_owned(),
            envelope_digest_b64u: crate::encode_base64url_bytes_v1(&envelope_digest),
            receipt_digest_b64u: crate::encode_base64url_bytes_v1(&receipt_digest),
        },
    )
}

/// Verifies one control-plane command, generates its role-local X25519 key,
/// seals the IKM with the established role-private D1 HPKE provider, and
/// durably records the public response before returning it.
#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_restore_role_import_key_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1> {
    tenant_root_deriver_restore_role_import_key_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}

/// Verifies one control-plane command, generates its role-local X25519 key,
/// seals the IKM with the role store's record key, and durably records the
/// public response before returning it.
pub async fn tenant_root_deriver_restore_role_import_key_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootRestoreRoleImportKeyRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRoleImportKeyResponseV1> {
    let role = tenant_root_creation_protocol_role_v1(host.worker_role())?;
    let role_private = match role {
        TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
        TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
    };
    let command_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root restore role-import command",
        &request.role_import_command_b64u,
    )?;
    if crate::encode_base64url_bytes_v1(&command_bytes) != request.role_import_command_b64u {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore role-import command must use canonical unpadded base64url",
        ));
    }
    let command = TenantRootRestoreRoleImportCommandV1::decode_canonical_bytes(&command_bytes)
        .map_err(candidate_derivation_error)?;
    if command.issuer_key_id() != request.issuer_key_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore role-import request issuer does not match its command",
        ));
    }
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(host.env())?;
    let trusted_key = issuer_keys
        .for_issuer_key_id(&request.issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root restore role-import issuer is not trusted by this Deriver",
            )
        })?;
    let verified = command
        .verify(&request.issuer_key_id, trusted_key)
        .map_err(candidate_derivation_error)?;
    if verified.role() != role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore role-import command belongs to the other Deriver",
        ));
    }
    let replay_key_digest = tenant_root_restore_import_replay_key_digest_v1(&verified);
    let store = host.role_store().map_err(|error| {
        tenant_root_store_error_v1("tenant-root restore import key store lookup", error)
    })?;
    if store
        .restore_import_session_is_closed(
            verified.destination_identity_digest(),
            verified.destination_lineage(),
            verified.restore_session_id(),
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore session tombstone lookup", error)
        })?
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root restore import session is closed",
        ));
    }
    if let Some(existing) = store
        .load_restore_import_key_by_replay(replay_key_digest)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore import replay lookup", error)
        })?
    {
        if existing.lifecycle()
            == crate::tenant_root_role_d1::CloudflareTenantRootRestoreImportKeyLifecycleV1::Closed
            || !restore_import_binding_matches_command_v1(
                existing.binding(),
                &verified,
                role_private,
                &replay_key_digest,
            )
        {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "tenant-root restore import replay conflicts with its signed scope",
            ));
        }
        return Ok(restore_import_key_response_v1(&existing));
    }
    verified.require_fresh(now_ms).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            format!("tenant-root restore role-import command is expired: {error}"),
        )
    })?;
    let mut ikm = Zeroizing::new([0_u8; 32]);
    getrandom::getrandom(ikm.as_mut()).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            format!("tenant-root restore import key randomness failed: {error}"),
        )
    })?;
    let keypair = TenantRootRestoreImportKeypairV1::derive_from_ikm(*ikm)
        .map_err(candidate_derivation_error)?;
    let binding = CloudflareTenantRootRestoreImportKeyBindingV1::new(
        verified.destination_identity_digest(),
        verified.destination_lineage(),
        verified.restore_session_id(),
        verified.recovery_set_id(),
        verified.destination_fingerprint(),
        *verified.manifest_digest(),
        verified.stable_root_commitment().to_bytes(),
        verified.recovery_share_commitment().to_bytes(),
        role_private,
        verified.generation(),
        verified.import_key_id().to_owned(),
        replay_key_digest,
        *verified.digest().as_bytes(),
        *verified.operation_digest().as_bytes(),
        keypair.public_key(),
        verified.issued_at_ms(),
        verified
            .issued_at_ms()
            .saturating_add(router_ab_core::TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1 as u64),
    )
    .map_err(|error| tenant_root_store_error_v1("tenant-root restore import binding", error))?;
    let encrypted_ikm = store
        .seal_restore_import_key_ikm(&binding, &*ikm)
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore import key encryption", error)
        })?;
    let record = CloudflareTenantRootRestoreImportKeyRecordV1::new_issued(binding, encrypted_ikm)
        .map_err(|error| {
        tenant_root_store_error_v1("tenant-root restore import key record", error)
    })?;
    let decision = store
        .persist_restore_import_key_issue(record, now_ms)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore import key persistence", error)
        })?;
    ikm.zeroize();
    drop(keypair);
    let stored = match decision {
        CloudflareTenantRootRestoreImportKeyIssueDecisionV1::Issued(record)
        | CloudflareTenantRootRestoreImportKeyIssueDecisionV1::Replay(record) => record,
    };
    Ok(restore_import_key_response_v1(&stored))
}

/// Verifies the existing issuer-signed command, opens one matching envelope,
/// and atomically stages the imported role share in the role-private restore
/// row. The command freshness window authorizes key issuance; the persisted
/// key window authorizes first-time envelope acceptance.
#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_restore_role_import_accept_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootRestoreRoleImportAcceptRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1> {
    tenant_root_deriver_restore_role_import_accept_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}

/// Verifies the issuer-signed command, opens one matching envelope, and
/// atomically stages the imported role share in the role-private restore
/// row. The command freshness window authorizes key issuance; the persisted
/// key window authorizes first-time envelope acceptance.
pub async fn tenant_root_deriver_restore_role_import_accept_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootRestoreRoleImportAcceptRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootRestoreRoleImportAcceptResponseV1> {
    let role = tenant_root_creation_protocol_role_v1(host.worker_role())?;
    let role_private = match role {
        TwoPartyDeriverRole::DeriverA => CloudflareTenantRootDeriverRoleV1::DeriverA,
        TwoPartyDeriverRole::DeriverB => CloudflareTenantRootDeriverRoleV1::DeriverB,
    };
    let command_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root restore role-import command",
        &request.role_import_command_b64u,
    )?;
    if crate::encode_base64url_bytes_v1(&command_bytes) != request.role_import_command_b64u {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore role-import command must use canonical unpadded base64url",
        ));
    }
    let command = TenantRootRestoreRoleImportCommandV1::decode_canonical_bytes(&command_bytes)
        .map_err(candidate_derivation_error)?;
    if command.issuer_key_id() != request.issuer_key_id {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore role-import request issuer does not match its command",
        ));
    }
    let issuer_keys =
        crate::env::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(host.env())?;
    let trusted_key = issuer_keys
        .for_issuer_key_id(&request.issuer_key_id)
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root restore role-import issuer is not trusted by this Deriver",
            )
        })?;
    let verified = command
        .verify(&request.issuer_key_id, trusted_key)
        .map_err(candidate_derivation_error)?;
    if verified.role() != role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root restore role-import command belongs to the other Deriver",
        ));
    }
    let envelope_bytes = crate::decode_base64url_bytes_v1(
        "tenant-root restore import envelope",
        &request.import_envelope_b64u,
    )?;
    if crate::encode_base64url_bytes_v1(&envelope_bytes) != request.import_envelope_b64u {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "tenant-root restore import envelope must use canonical unpadded base64url",
        ));
    }
    let envelope = TenantRootRestoreImportEnvelopeV1::decode(&envelope_bytes)
        .map_err(candidate_derivation_error)?;
    let envelope_digest: [u8; 32] = Sha256::digest(&envelope_bytes).into();
    let replay_key_digest = tenant_root_restore_import_replay_key_digest_v1(&verified);
    let store = host.role_store().map_err(|error| {
        tenant_root_store_error_v1("tenant-root restore import acceptance store lookup", error)
    })?;
    if store
        .restore_import_session_is_closed(
            verified.destination_identity_digest(),
            verified.destination_lineage(),
            verified.restore_session_id(),
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore session tombstone lookup", error)
        })?
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root restore import session is closed",
        ));
    }
    let existing = store
        .load_restore_import_key_by_replay(replay_key_digest)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore import acceptance replay lookup", error)
        })?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore import key was not issued by this Deriver",
            )
        })?;
    if existing.lifecycle()
        == crate::tenant_root_role_d1::CloudflareTenantRootRestoreImportKeyLifecycleV1::Closed
        || !restore_import_binding_matches_command_v1(
            existing.binding(),
            &verified,
            role_private,
            &replay_key_digest,
        )
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root restore import acceptance conflicts with its signed scope",
        ));
    }
    if existing.lifecycle()
        == crate::tenant_root_role_d1::CloudflareTenantRootRestoreImportKeyLifecycleV1::Installed
    {
        if existing.envelope_digest() != Some(envelope_digest) {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ConflictingPair,
                "tenant-root restore import envelope conflicts with its accepted replay",
            ));
        }
        store
            .validate_restore_imported_share(&existing)
            .map_err(|error| {
                tenant_root_store_error_v1(
                    "tenant-root restore imported share replay validation",
                    error,
                )
            })?;
        return restore_import_accept_response_v1(&existing);
    }
    if existing.lifecycle()
        != crate::tenant_root_role_d1::CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "tenant-root restore import key is no longer available for acceptance",
        ));
    }
    if now_ms < existing.binding().issued_at_ms() || now_ms >= existing.binding().expires_at_ms() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "tenant-root restore import key acceptance window has expired",
        ));
    }
    let current = store
        .load_current_restore_import_key(
            verified.destination_identity_digest(),
            verified.destination_lineage(),
            verified.restore_session_id(),
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore import current-key lookup", error)
        })?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root restore import current key is missing",
            )
        })?;
    if current.binding().replay_key_digest() != existing.binding().replay_key_digest()
        || current.lifecycle()
            != crate::tenant_root_role_d1::CloudflareTenantRootRestoreImportKeyLifecycleV1::Issued
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ConflictingPair,
            "tenant-root restore import key is not the current generation",
        ));
    }
    let ikm = store
        .open_restore_import_key_ikm(&existing)
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore import key decryption", error)
        })?;
    let keypair = TenantRootRestoreImportKeypairV1::derive_from_ikm(*ikm)
        .map_err(candidate_derivation_error)?;
    let expected = ExpectedTenantRootRestoreImportV1::from_verified_command(
        &verified,
        existing.binding().import_public_key(),
        existing.binding().issued_at_ms(),
        existing.binding().expires_at_ms(),
    )
    .map_err(candidate_derivation_error)?;
    let imported = envelope
        .open(&expected, &keypair)
        .map_err(candidate_derivation_error)?;
    let share_wire = imported.into_share_wire();
    let share_bytes = Zeroizing::new(share_wire.to_bytes());
    let encrypted_imported_share_json = store
        .seal_restore_imported_share(existing.binding(), &envelope_digest, &share_bytes[..])
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore imported share encryption", error)
        })?;
    let receipt_digest =
        tenant_root_restore_import_accept_receipt_digest_v1(&existing, &envelope_digest);
    let decision = store
        .persist_restore_import_key_accept(
            &existing,
            envelope_digest,
            encrypted_imported_share_json,
            receipt_digest,
            now_ms,
        )
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root restore imported share persistence", error)
        })?;
    let stored = match decision {
        CloudflareTenantRootRestoreImportKeyAcceptDecisionV1::Accepted(record)
        | CloudflareTenantRootRestoreImportKeyAcceptDecisionV1::Replay(record) => record,
    };
    restore_import_accept_response_v1(&stored)
}

#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_cloudflare_deriver_tenant_root_status_v1(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootStatusRequestV1,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootStatusResponseV1> {
    let (expected_protocol_role, expected_managed_role, expected_wire_role) = match worker_role {
        crate::CloudflareWorkerRoleV1::DeriverA => (
            TwoPartyDeriverRole::DeriverA,
            TenantRootManagedRestoreRoleV1::DeriverA,
            CloudflareTenantRootCreateRoleV1::DeriverA,
        ),
        crate::CloudflareWorkerRoleV1::DeriverB => (
            TwoPartyDeriverRole::DeriverB,
            TenantRootManagedRestoreRoleV1::DeriverB,
            CloudflareTenantRootCreateRoleV1::DeriverB,
        ),
        _ => {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidRole,
                "tenant-root status is available only on Deriver Workers",
            ));
        }
    };
    let identity_digest =
        TenantRootIdentityDigestV1::from_bytes(decode_exact_tenant_root_status_digest_v1(
            "tenant-root status identity digest",
            &request.identity_digest_b64u,
        )?);
    let custody_lineage = TenantRootCustodyLineageId::from_base64url(&request.custody_lineage_b64u)
        .map_err(candidate_derivation_error)?;
    let active_epoch =
        TenantRootShareEpoch::new(request.active_epoch).map_err(candidate_derivation_error)?;
    let store = CloudflareTenantRootRoleShareStoreV1::from_env(env).map_err(|error| {
        tenant_root_store_error_v1("tenant-root status role store lookup", error)
    })?;
    let stored = store
        .load_epoch_by_identity_digest(identity_digest, custody_lineage, active_epoch)
        .await
        .map_err(|error| {
            tenant_root_store_error_v1("tenant-root status active share lookup", error)
        })?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLifecycleState,
                "tenant-root status active role share does not exist",
            )
        })?;
    let binding = stored
        .active_binding()
        .map_err(|error| tenant_root_store_error_v1("tenant-root status active binding", error))?;
    if binding.identity_digest() != identity_digest
        || binding.custody_lineage() != custody_lineage
        || binding.epoch() != active_epoch
        || binding.role() != expected_managed_role
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root status active role share binding does not match this Deriver",
        ));
    }

    let sealed = stored.into_online_role_share_artifact().map_err(|error| {
        tenant_root_store_error_v1("tenant-root status share reconstruction", error)
    })?;
    let mut provider =
        crate::env::load_cloudflare_tenant_root_operational_rotation_provider_v1(env, worker_role)?;
    let opened = open_tenant_root_online_role_share_v1(sealed, &mut provider).map_err(|_| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "tenant-root status provider readback failed",
        )
    })?;
    if opened.identity_digest() != identity_digest
        || opened.custody_lineage() != custody_lineage
        || opened.epoch() != active_epoch
        || opened.role() != expected_protocol_role
        || opened.share_commitment() != binding.share_commitment()
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root status provider readback does not match the active role binding",
        ));
    }
    drop(opened);

    Ok(CloudflareDeriverTenantRootStatusResponseV1 {
        identity_digest_b64u: crate::encode_base64url_bytes_v1(identity_digest.as_bytes()),
        custody_lineage_b64u: custody_lineage.to_base64url(),
        active_epoch: active_epoch.get().get(),
        role: expected_wire_role,
        share_commitment_b64u: crate::encode_base64url_bytes_v1(
            binding.share_commitment().as_bytes(),
        ),
        activation_receipt_digest_b64u: crate::encode_base64url_bytes_v1(
            binding.activation_receipt_digest().as_bytes(),
        ),
    })
}
