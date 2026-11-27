//! Creation package verification and admission, attempt finalization, sealing, preactivation cleanup and role creation.

use super::*;

/// Admits one issuer-signed role creation package at a Deriver's own boundary.
///
/// This is where a Deriver stops trusting its caller. The package arrived over
/// an internally authenticated hop, but internal-service auth proves only
/// "inside the deployment"; the authorization comes from the issuer signature,
/// checked here against this Worker's own configured anchor.
///
/// `worker_role` is the role this Worker *is*, taken from its own runtime, and
/// it is what the command must match. Passing the command's own role would make
/// the check vacuous and let a Deriver execute its peer's command.
///
/// On success the Deriver holds a live share it has committed to. The scalar
/// never leaves this process: only the signed public commitment does.
pub(crate) fn verify_tenant_root_role_creation_package_v1(
    package_bytes: &[u8],
    worker_role: TwoPartyDeriverRole,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_keys: &CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
) -> RouterAbProtocolResult<VerifiedTenantRootRoleCreationCommandPackageV1> {
    if role_signer.role() != worker_role {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root role signer does not belong to this Worker's role",
        ));
    }
    let package = TenantRootRoleCreationCommandPackageV1::decode_canonical_bytes(package_bytes)
        .map_err(candidate_derivation_error)?;
    // The trusted key is selected by the command's issuer key id but supplied by
    // this Worker's configuration: an unpublished issuer has no key here, so an
    // unsigned or foreign-signed package cannot proceed.
    let issuer_key_id = package.issuer_key_id().to_owned();
    let Some(trusted_key) = trusted_issuer_keys.for_issuer_key_id(&issuer_key_id) else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root role creation command issuer is not trusted by this Worker",
        ));
    };
    let verified = package
        .verify(
            worker_role,
            expected_authority_id,
            &issuer_key_id,
            trusted_key,
        )
        .map_err(candidate_derivation_error)?;
    let context = verified.creation_context().clone();
    // The ceremony must name THIS Worker's signing key: a ceremony expecting a
    // different role signer is not one this Worker may execute.
    if context.signing_key_id(worker_role) != role_signer.signing_key_id() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root ceremony does not name this Worker's role signing key",
        ));
    }
    Ok(verified)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn admit_tenant_root_role_creation_package_v1<R>(
    package_bytes: &[u8],
    worker_role: TwoPartyDeriverRole,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_keys: &CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
    now_ms: u64,
    rng: &mut R,
) -> RouterAbProtocolResult<PendingTenantRootInitialRoleAttemptV1>
where
    R: rand_core_06::RngCore + rand_core_06::CryptoRng,
{
    let verified = verify_tenant_root_role_creation_package_v1(
        package_bytes,
        worker_role,
        expected_authority_id,
        trusted_issuer_keys,
        role_signer,
    )?;
    let context = verified.creation_context().clone();
    role_signer
        .begin_initial_role_attempt(verified.into_command(), context, now_ms, rng)
        .map_err(candidate_derivation_error)
}

pub(super) fn candidate_derivation_error(error: RouterAbDerivationError) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::MalformedWirePayload,
        format!("tenant-root role creation package was refused: {error}"),
    )
}

/// The rendezvous outcome a Deriver receives back from the Router-owned object.
///
/// Public evidence only: two signed commitments and the pair digest the object
/// computed. Nothing here is role-private, which is why it may cross back to
/// the peer Deriver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TenantRootCreationCommitmentPairWiresV1 {
    pub(crate) deriver_a_signed_commitment: Vec<u8>,
    pub(crate) deriver_b_signed_commitment: Vec<u8>,
}

/// Finalizes this role's attempt against the completed commitment pair.
///
/// Both commitments are re-verified here against the ceremony context and the
/// published role keys. The Deriver does not trust the object's assembly of the
/// pair: it trusts the two role signatures, which the object cannot forge.
///
/// The peer's commitment is a public curve point. The scalar stays in this
/// process; what leaves is the signed installation evidence.
pub(crate) fn finalize_tenant_root_role_attempt_v1<R>(
    pending: PendingTenantRootInitialRoleAttemptV1,
    pair_wires: &TenantRootCreationCommitmentPairWiresV1,
    context: &TenantRootCeremonyContextV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    role_signer: &CloudflareTenantRootCreationRoleSignerV1,
    rng: &mut R,
) -> RouterAbProtocolResult<VerifiedTenantRootInitialRoleAttemptV1>
where
    R: rand_core_06::RngCore + rand_core_06::CryptoRng,
{
    let pair = VerifiedTenantRootCreationCommitmentPairV1::new(
        decode_verified_creation_commitment_v1(
            &pair_wires.deriver_a_signed_commitment,
            context,
            TwoPartyDeriverRole::DeriverA,
            role_keys,
        )?,
        decode_verified_creation_commitment_v1(
            &pair_wires.deriver_b_signed_commitment,
            context,
            TwoPartyDeriverRole::DeriverB,
            role_keys,
        )?,
    )
    .map_err(candidate_derivation_error)?;
    // finalize() independently requires the pair to contain THIS role's exact
    // commitment, so a pair assembled from someone else's ceremony is refused.
    role_signer
        .finalize_initial_role_attempt(pending, pair, rng)
        .map_err(candidate_derivation_error)
}

/// Seals a finalized role attempt and builds its role-local persistence input.
///
/// This is the last step before anything durable exists for this role. The
/// scalar is consumed here: it goes into the online provider's sealed
/// ciphertext and the managed backup, and neither the returned value nor
/// anything it contains carries it in the clear.
///
/// The returned input is not yet persisted. Reservation and insertion are
/// separate, one-use, and exactly retryable, so a lost response after sealing
/// re-reserves the same command rather than creating a second share.
pub(crate) async fn seal_initial_role_creation_for_persistence_v1<Online, Backup>(
    finalized: VerifiedTenantRootInitialRoleAttemptV1,
    signer: &crate::CloudflareTenantRootCreationRoleSignerV1,
    provider_config: &TenantRootRoleRuntimeProviderConfigV1,
    online_provider: &mut Online,
    managed_backup_provider: &mut Backup,
    identity: TenantRootIdentityV1,
    staged_at_ms: u64,
) -> RouterAbProtocolResult<(
    CloudflareTenantRootInitialCreationInputV1,
    VerifiedTenantRootManagedBackupV1,
    Vec<u8>,
)>
where
    Online: TenantRootOnlineRoleShareProviderV1,
    Backup: TenantRootManagedBackupProviderV1,
{
    let (command, evidence, artifacts) = compose_initial_tenant_root_role_runtime_v1(
        finalized,
        signer,
        provider_config,
        online_provider,
        managed_backup_provider,
        staged_at_ms,
    )
    .await
    .map_err(candidate_derivation_error)?;
    // The command names the tenant; the caller's identity must be that tenant,
    // so a mis-supplied identity cannot seal a share under the wrong record.
    let identity_digest = identity.digest().map_err(candidate_derivation_error)?;
    if identity_digest != command.identity_digest() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root sealing identity does not match its authorized command",
        ));
    }
    let (online_sealed, managed_backup, provider_canary_receipt) = artifacts.into_parts();
    let input = CloudflareTenantRootInitialCreationInputV1::new(
        command,
        evidence,
        CloudflareTenantRootInitialCreationShareInputV1::new(identity, online_sealed, staged_at_ms),
    )
    .map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            format!("tenant-root role creation persistence input was refused: {error}"),
        )
    })?;
    Ok((input, managed_backup, provider_canary_receipt))
}

/// Maximum accepted request size for one Deriver restore import-key request.
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) const DERIVER_TENANT_ROOT_RESTORE_ROLE_IMPORT_KEY_REQUEST_MAX_BYTES_V1: usize = 64 * 1024;

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) const DERIVER_TENANT_ROOT_RESTORE_SESSION_CLEANUP_REQUEST_MAX_BYTES_V1: usize = 24 * 1024;

#[cfg(feature = "workers-rs")]
#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint",
    test
))]
pub(crate) async fn handle_restore_preactivation_cleanup(
    env: &worker::Env,
    worker_role: crate::CloudflareWorkerRoleV1,
    request: CloudflareDeriverTenantRootPreactivationCleanupRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootPreactivationCleanupResponseV1> {
    tenant_root_deriver_restore_preactivation_cleanup_v1(
        &CloudflareTenantRootDeriverHostV1::new(env, worker_role, None),
        request,
        now_ms,
    )
    .await
}

/// Closes one restore before its activation, under an operator cleanup grant.
pub async fn tenant_root_deriver_restore_preactivation_cleanup_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootPreactivationCleanupRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootPreactivationCleanupResponseV1> {
    let worker_role = host.worker_role();
    let role = tenant_root_creation_protocol_role_v1(worker_role)?;
    let bytes =
        crate::decode_base64url_bytes_v1("restore cleanup grant", &request.cleanup_grant_b64u)?;
    if crate::encode_base64url_bytes_v1(&bytes) != request.cleanup_grant_b64u {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "restore cleanup grant must use canonical base64url",
        ));
    }
    let grant = router_ab_core::TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&bytes)
        .map_err(candidate_derivation_error)?;
    let reader = host.env();
    let keys = crate::env::parse_cloudflare_tenant_root_creation_grant_authority_verifying_keys_v1(
        reader,
    )?;
    let key = keys.for_grant_key_id(grant.grant_key_id()).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "restore cleanup grant authority is not trusted",
        )
    })?;
    let verified = grant
        .verify(grant.grant_key_id(), key)
        .map_err(candidate_derivation_error)?;
    verified
        .require_fresh(now_ms)
        .map_err(candidate_derivation_error)?;
    let store = host.role_store()
        .map_err(|error| tenant_root_store_error_v1("restore cleanup store", error))?;
    let receipt = store
        .close_restore_before_activation(&verified, now_ms)
        .await
        .map_err(|error| tenant_root_store_error_v1("restore preactivation cleanup", error))?;
    Ok(CloudflareDeriverTenantRootPreactivationCleanupResponseV1 {
        role: CloudflareTenantRootCreateRoleV1::from_protocol(role),
        cleanup_receipt_digest_b64u: crate::encode_base64url_bytes_v1(receipt.digest().as_bytes()),
    })
}

/// One role's outcome for a creation ceremony, before any transport.
///
/// `Committed` is the first leg: this role holds a live share and has
/// published its commitment, but the pair is not complete, so nothing durable
/// exists yet and the attempt is abandonable by simply dropping it.
///
/// `Sealed` is the second leg: the pair completed, the share is sealed, and the
/// input is ready for the role's one-use reserve-and-insert.
// The sealed variant is boxed, but the committed variant deliberately is not:
// it holds the live share, and moving secret material onto the heap to satisfy
// a size lint would trade a zeroizing stack value for an allocation whose
// intermediate copies are harder to reason about.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
pub(crate) enum TenantRootRoleCreationProgressV1 {
    Committed {
        pending: PendingTenantRootInitialRoleAttemptV1,
    },
    Sealed {
        signed_commitment: Vec<u8>,
        signed_installation_evidence: Vec<u8>,
        /// Boxed: the persistence input dwarfs the committed variant, and this
        /// enum is returned by value from every role execution.
        input: Box<CloudflareTenantRootInitialCreationInputV1>,
        managed_backup: Box<VerifiedTenantRootManagedBackupV1>,
        completion: TenantRootRoleCreationCompletionV1,
    },
}

/// Distinguishes a role-only completion from an initiator completion that also
/// retains the peer's exact public artifacts for the Router activation call.
#[derive(Debug)]
pub(crate) enum TenantRootRoleCreationCompletionV1 {
    RoleOnly {
        provider_canary_receipt: Vec<u8>,
    },
    Initiator {
        provider_canary_receipt: Vec<u8>,
        peer: Box<TenantRootPeerRoleOutcomeV1>,
    },
}

/// One role's outcome for a refresh ceremony, before persistence.
// The committed variant owns the coefficient and current share; the sealed
// variant owns the provider-backed pending-row input after finalization.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
#[cfg(test)]
pub(crate) enum TenantRootRoleRefreshProgressV1 {
    Committed {
        pending: PendingTenantRootRefreshRoleAttemptV1,
    },
    #[cfg(feature = "workers-rs")]
    Sealed {
        signed_commitment: Vec<u8>,
        signed_installation_evidence: Vec<u8>,
        input: Box<CloudflareTenantRootRefreshInputV1>,
        managed_backup: Box<VerifiedTenantRootManagedBackupV1>,
        provider_canary_receipt: Vec<u8>,
    },
}

/// Starts one role-local refresh attempt from already-verified public state
/// and the provider-opened current share.
#[allow(clippy::too_many_arguments)]
#[cfg(test)]
pub(crate) fn begin_tenant_root_role_refresh_v1<R>(
    command: VerifiedTenantRootRoleRefreshCommandV1,
    context: TenantRootCeremonyContextV1,
    active_binding: TenantRootActiveRoleBindingV1,
    current_share: SigningRootShare,
    role_signing_key_bytes: &[u8; 32],
    expected_role_verifying_key_bytes: &[u8; 32],
    recipient_key_id: impl Into<String>,
    recipient_public_key: TenantRootRefreshHpkePublicKeyV1,
    now_ms: u64,
    rng: &mut R,
) -> RouterAbProtocolResult<TenantRootRoleRefreshProgressV1>
where
    R: rand_core_06::RngCore + rand_core_06::CryptoRng,
{
    let pending = PendingTenantRootRefreshRoleAttemptV1::new(
        command,
        context,
        active_binding,
        current_share,
        role_signing_key_bytes,
        expected_role_verifying_key_bytes,
        recipient_key_id,
        recipient_public_key,
        now_ms,
        rng,
    )
    .map_err(candidate_derivation_error)?;
    Ok(TenantRootRoleRefreshProgressV1::Committed { pending })
}

/// Finalizes a live refresh attempt and seals its next-epoch share for the
/// role-private pending-row insertion path.
#[cfg(feature = "workers-rs")]
#[allow(clippy::too_many_arguments)]
#[cfg(test)]
pub(crate) async fn finalize_tenant_root_role_refresh_v1<Online, Backup, R>(
    pending: PendingTenantRootRefreshRoleAttemptV1,
    commitment_pair: VerifiedTenantRootRefreshCommitmentPairV1,
    peer_contribution: RootShareRefreshContributionWire,
    role_signer: &crate::CloudflareTenantRootCreationRoleSignerV1,
    identity: TenantRootIdentityV1,
    provider_config: &TenantRootRoleRuntimeProviderConfigV1,
    online_provider: &mut Online,
    managed_backup_provider: &mut Backup,
    staged_at_ms: u64,
    rng: &mut R,
) -> RouterAbProtocolResult<TenantRootRoleRefreshProgressV1>
where
    Online: TenantRootOnlineRoleShareProviderV1,
    Backup: TenantRootManagedBackupProviderV1,
    R: rand_core_06::RngCore + rand_core_06::CryptoRng,
{
    let signed_commitment = pending.commitment_bytes().to_vec();
    let finalized = pending
        .finalize(commitment_pair, peer_contribution, rng)
        .map_err(candidate_derivation_error)?;
    let (input, managed_backup, provider_canary_receipt) = seal_refresh_role_for_persistence_v1(
        finalized,
        role_signer,
        identity,
        provider_config,
        online_provider,
        managed_backup_provider,
        staged_at_ms,
    )
    .await?;
    let signed_installation_evidence = input.installation_evidence_bytes().to_vec();
    Ok(TenantRootRoleRefreshProgressV1::Sealed {
        signed_commitment,
        signed_installation_evidence,
        input: Box::new(input),
        managed_backup: Box::new(managed_backup),
        provider_canary_receipt,
    })
}

/// Executes one role's part of a creation ceremony.
///
/// `worker_role` and `expected_authority_id` come from the Worker's own
/// runtime and Durable Object binding; `role_signer` is its own configured
/// signer. None of them may be taken from the request, which is why they are
/// arguments rather than fields of the decoded package.
///
/// With no peer commitment this returns `Committed`: the role generates and
/// commits, and its commitment goes back so the peer can be driven. With the
/// peer's commitment it finalizes and seals in the same call, so the scalar
/// never has to survive across a request boundary.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute_tenant_root_role_creation_v1<Online, Backup, R>(
    package_bytes: &[u8],
    peer_signed_commitment: Option<&[u8]>,
    worker_role: TwoPartyDeriverRole,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_keys: &CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    role_signer: &crate::CloudflareTenantRootCreationRoleSignerV1,
    provider_config: &TenantRootRoleRuntimeProviderConfigV1,
    online_provider: &mut Online,
    managed_backup_provider: &mut Backup,
    now_ms: u64,
    rng: &mut R,
) -> RouterAbProtocolResult<TenantRootRoleCreationProgressV1>
where
    Online: TenantRootOnlineRoleShareProviderV1,
    Backup: TenantRootManagedBackupProviderV1,
    R: rand_core_06::RngCore + rand_core_06::CryptoRng,
{
    let pending = admit_tenant_root_role_creation_package_v1(
        package_bytes,
        worker_role,
        expected_authority_id,
        trusted_issuer_keys,
        role_signer,
        now_ms,
        rng,
    )?;
    let Some(peer_signed_commitment) = peer_signed_commitment else {
        return Ok(TenantRootRoleCreationProgressV1::Committed { pending });
    };

    // The identity comes from the package's own Started journal, which the
    // issuer signature already commits to; it is never a request field.
    let package = TenantRootRoleCreationCommandPackageV1::decode_canonical_bytes(package_bytes)
        .map_err(candidate_derivation_error)?;
    let identity = package.identity().map_err(candidate_derivation_error)?;

    let signed_commitment = pending.commitment_bytes().to_vec();
    let context = pending.commitment().context().clone();
    let pair_wires = match worker_role {
        TwoPartyDeriverRole::DeriverA => TenantRootCreationCommitmentPairWiresV1 {
            deriver_a_signed_commitment: signed_commitment.clone(),
            deriver_b_signed_commitment: peer_signed_commitment.to_vec(),
        },
        TwoPartyDeriverRole::DeriverB => TenantRootCreationCommitmentPairWiresV1 {
            deriver_a_signed_commitment: peer_signed_commitment.to_vec(),
            deriver_b_signed_commitment: signed_commitment.clone(),
        },
    };
    let finalized = finalize_tenant_root_role_attempt_v1(
        pending,
        &pair_wires,
        &context,
        role_keys,
        role_signer,
        rng,
    )?;
    let (input, managed_backup, provider_canary_receipt) =
        seal_initial_role_creation_for_persistence_v1(
            finalized,
            role_signer,
            provider_config,
            online_provider,
            managed_backup_provider,
            identity,
            now_ms,
        )
        .await?;
    let signed_installation_evidence = input.installation_evidence_bytes().to_vec();
    Ok(TenantRootRoleCreationProgressV1::Sealed {
        signed_commitment,
        signed_installation_evidence,
        input: Box::new(input),
        managed_backup: Box::new(managed_backup),
        completion: TenantRootRoleCreationCompletionV1::RoleOnly {
            provider_canary_receipt,
        },
    })
}
