//! Commitment decoding, peer persistence attestation, the peer role driver and the Deriver host.

use super::*;

/// Recovers the committed point from a signed commitment wire.
pub(super) fn decode_signed_commitment_point(
    signed_commitment: &[u8],
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<threshold_prf::SigningRootShareCommitment> {
    Ok(
        decode_verified_creation_commitment_v1(signed_commitment, context, role, role_keys)?
            .commitment(),
    )
}

/// Strictly verifies one exact signed commitment before it reaches either
/// local persistence or the Router-owned checkpoint.
pub(super) fn decode_verified_creation_commitment_v1(
    signed_commitment: &[u8],
    context: &TenantRootCeremonyContextV1,
    role: TwoPartyDeriverRole,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
) -> RouterAbProtocolResult<VerifiedTenantRootCreationCommitmentV1> {
    let signing_key_id = context.signing_key_id(role);
    let trusted = role_keys
        .for_role_and_key_id(role, signing_key_id)
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root ceremony names a signing key that is not published",
            )
        })?;
    let signed = TenantRootSignedCreationCommitmentV1::decode_canonical_bytes(signed_commitment)
        .map_err(candidate_derivation_error)?;
    signed
        .verify_strict(context, role, signing_key_id, trusted)
        .map_err(candidate_derivation_error)
}

/// A verified role attestation that the peer completed its own insertion.
///
/// This is the peer's signed statement, checked against expectations the
/// verifier derived independently. It is NOT independent proof of the peer's
/// D1 state: only the peer can observe its own store. A peer whose role key is
/// compromised can attest an insertion that did not happen, which is why the
/// role signing keys are role-local and never leave their Deriver.
///
/// Deliberately neither cloneable nor serializable: it is a conclusion reached
/// locally from verified bytes, not a value to forward.
pub(crate) struct VerifiedTenantRootPeerPersistenceAttestationV1 {
    pub(super) peer_role: TwoPartyDeriverRole,
}

/// Verifies a peer's terminal receipt using only public expectations.
///
/// The security split is deliberate. The peer verifies the full command digest
/// locally against its own `ExecutedTenantRootCommandV1`, because that digest
/// covers the peer's sealed record and is role-private. The verifier here
/// checks the public attestation instead: the exact replay key, the exact
/// installation-evidence bytes, the expected role and signing key id, the role
/// signature, and the ceremony timing.
///
/// The peer's issuer-signed package yields the replay key. It does not yield
/// the command digest, and this function does not attempt to derive one.
/// Requiring that would either expose the peer's private ciphertext inputs or
/// introduce a second public command digest with overlapping semantics.
///
/// The payload binding is what constrains the receipt: it must attest exactly
/// this installation, not another operation by the same role in the ceremony.
#[allow(clippy::too_many_arguments)]
pub(crate) fn verify_tenant_root_peer_persistence_v1(
    terminal_receipt_bytes: &[u8],
    peer_package_bytes: &[u8],
    peer_signed_installation_evidence: &[u8],
    peer_role: TwoPartyDeriverRole,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_keys: &CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    context: &TenantRootCeremonyContextV1,
) -> RouterAbProtocolResult<VerifiedTenantRootPeerPersistenceAttestationV1> {
    let peer_package =
        TenantRootRoleCreationCommandPackageV1::decode_canonical_bytes(peer_package_bytes)
            .map_err(candidate_derivation_error)?;
    let issuer_key_id = peer_package.issuer_key_id().to_owned();
    let Some(trusted_issuer_key) = trusted_issuer_keys.for_issuer_key_id(&issuer_key_id) else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root peer command issuer is not trusted by this Worker",
        ));
    };
    if peer_package
        .creation_context()
        .map_err(candidate_derivation_error)?
        != *context
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root peer command belongs to a different ceremony",
        ));
    }
    let peer_command = peer_package
        .verify(
            peer_role,
            expected_authority_id,
            &issuer_key_id,
            trusted_issuer_key,
        )
        .map_err(candidate_derivation_error)?
        .into_command();

    let signing_key_id = context.signing_key_id(peer_role);
    let trusted_role_key = role_keys
        .for_role_and_key_id(peer_role, signing_key_id)
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root ceremony names a peer signing key that is not published",
            )
        })?;

    // A failure receipt is not persistence: only the success variant attests
    // that the peer's insertion completed.
    let TenantRootCommandTerminalReceiptV1::Success(receipt) =
        TenantRootCommandTerminalReceiptV1::decode_canonical_bytes(terminal_receipt_bytes)
            .map_err(candidate_derivation_error)?
    else {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root peer returned a failure receipt, which is not persistence",
        ));
    };
    receipt
        .verify_remote_public(
            peer_command.scope().key(),
            peer_signed_installation_evidence,
            context.issued_at_ms(),
            signing_key_id,
            trusted_role_key,
        )
        .map_err(candidate_derivation_error)?;
    Ok(VerifiedTenantRootPeerPersistenceAttestationV1 { peer_role })
}

/// Drives the peer Deriver over a service binding.
///
/// Async because the real call is a Worker-to-Worker service binding and must
/// be awaited. Modelled as a trait so the initiating role's orchestration is
/// testable without a Worker, and so only bytes ever cross to the peer.
pub(crate) trait TenantRootPeerRoleDriverV1 {
    /// Hands the peer everything it needs and receives its public result.
    ///
    /// The peer receives its command package and the initiator's exact signed
    /// commitment. It cannot recompute that commitment: the initiator's share is
    /// random and lives only in the initiator's process, so the commitment has
    /// to travel.
    async fn drive_peer(
        &mut self,
        peer_package_bytes: &[u8],
        initiator_signed_commitment: &[u8],
    ) -> RouterAbProtocolResult<TenantRootPeerRoleOutcomeV1>;
}

/// What the peer returns: authenticated public bytes only.
///
/// Deliberately not a "persisted" boolean. A boolean is the peer's own claim and
/// admits states that never happened; these are artifacts the initiator can
/// check against the ceremony it is already party to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TenantRootPeerRoleOutcomeV1 {
    /// The peer's signed public commitment.
    pub(crate) signed_commitment: Vec<u8>,
    /// The peer's signed installation evidence, which the initiator verifies.
    pub(crate) signed_installation_evidence: Vec<u8>,
    /// The peer's opaque signed managed-backup artifact.
    pub(crate) signed_managed_backup: Vec<u8>,
    /// The peer's exact signed online-provider canary receipt.
    pub(crate) provider_canary_receipt: Vec<u8>,
    /// The peer's role-signed terminal receipt for its own insertion.
    ///
    /// Fully verified by the initiator against expectations it computes from
    /// public material: the peer's own issuer-signed package yields the replay
    /// key, and the ceremony yields the signing key id, trusted verifying key,
    /// and earliest legitimate terminal time.
    pub(crate) terminal_receipt: Vec<u8>,
}

/// Runs the initiating role's ceremony without ever parking its scalar.
///
/// The initiating role commits, drives the peer, and finalizes inside a single
/// invocation. Its share is random, so it cannot be regenerated on a later
/// request: parking the commitment durably and returning would strand a
/// ceremony whose scalar no longer exists. Holding the request open for the
/// peer call is what makes the share's lifetime equal to this function's.
///
/// If the peer call fails, or the peer's commitment does not complete the
/// pair, this returns an error and the share is dropped. Nothing durable was
/// written for the initiating role, so the attempt is abandoned by returning.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn drive_tenant_root_role_creation_as_initiator_v1<Online, Backup, Peer, R>(
    package_bytes: &[u8],
    peer_package_bytes: &[u8],
    worker_role: TwoPartyDeriverRole,
    expected_authority_id: TenantRootControlPlaneAuthorityIdV1,
    trusted_issuer_keys: &CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1,
    role_keys: &TenantRootCreationRoleVerifyingKeysV1,
    role_signer: &crate::CloudflareTenantRootCreationRoleSignerV1,
    provider_config: &TenantRootRoleRuntimeProviderConfigV1,
    online_provider: &mut Online,
    managed_backup_provider: &mut Backup,
    peer: &mut Peer,
    now_ms: u64,
    rng: &mut R,
) -> RouterAbProtocolResult<TenantRootRoleCreationProgressV1>
where
    Online: TenantRootOnlineRoleShareProviderV1,
    Backup: TenantRootManagedBackupProviderV1,
    Peer: TenantRootPeerRoleDriverV1,
    R: rand_core_06::RngCore + rand_core_06::CryptoRng,
{
    // Commit first, so the peer is only ever driven for a ceremony this role
    // has already been authorized to execute.
    let pending = admit_tenant_root_role_creation_package_v1(
        package_bytes,
        worker_role,
        expected_authority_id,
        trusted_issuer_keys,
        role_signer,
        now_ms,
        rng,
    )?;
    let signed_commitment = pending.commitment_bytes().to_vec();
    let context = pending.commitment().context().clone();

    // The share stays on this stack for exactly the span of the peer call. The
    // peer receives the initiator's exact commitment because it cannot derive
    // it: that share exists only here.
    let peer_outcome = peer
        .drive_peer(peer_package_bytes, &signed_commitment)
        .await?;
    let peer_role = worker_role.peer();
    let peer_verifying_key = role_keys
        .for_role_and_key_id(peer_role, context.signing_key_id(peer_role))
        .map_err(|_| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root ceremony names a peer signing key that is not published",
            )
        })?;
    let peer_evidence =
        TenantRootSignedShareInstallationEvidenceV1::decode_and_verify_canonical_bytes(
            &peer_outcome.signed_installation_evidence,
            peer_verifying_key,
        )
        .map_err(candidate_derivation_error)?;
    let peer_transcript = peer_evidence.evidence().transcript();
    if peer_transcript.role() != peer_role || peer_transcript.context() != &context {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root peer installation evidence belongs to a different ceremony",
        ));
    }
    // Bind the evidence to the exact pair. A valid peer signature over some
    // OTHER pair satisfies every check above but attests a different ceremony
    // outcome.
    let initiator_commitment =
        decode_signed_commitment_point(&signed_commitment, &context, worker_role, role_keys)?;
    let peer_commitment_point = decode_signed_commitment_point(
        &peer_outcome.signed_commitment,
        &context,
        peer_role,
        role_keys,
    )?;
    if peer_transcript.commitment() != peer_commitment_point
        || peer_transcript.peer_commitment() != initiator_commitment
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ForbiddenLocalBinding,
            "tenant-root peer installation evidence is not bound to this commitment pair",
        ));
    }
    // The peer's persistence is a verified conclusion, not a reported claim.
    let _peer_persistence = verify_tenant_root_peer_persistence_v1(
        &peer_outcome.terminal_receipt,
        peer_package_bytes,
        &peer_outcome.signed_installation_evidence,
        peer_role,
        expected_authority_id,
        trusted_issuer_keys,
        role_keys,
        &context,
    )?;

    let pair_wires = match worker_role {
        TwoPartyDeriverRole::DeriverA => TenantRootCreationCommitmentPairWiresV1 {
            deriver_a_signed_commitment: signed_commitment.clone(),
            deriver_b_signed_commitment: peer_outcome.signed_commitment.clone(),
        },
        TwoPartyDeriverRole::DeriverB => TenantRootCreationCommitmentPairWiresV1 {
            deriver_a_signed_commitment: peer_outcome.signed_commitment.clone(),
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
    let package = TenantRootRoleCreationCommandPackageV1::decode_canonical_bytes(package_bytes)
        .map_err(candidate_derivation_error)?;
    let identity = package.identity().map_err(candidate_derivation_error)?;
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
        completion: TenantRootRoleCreationCompletionV1::Initiator {
            provider_canary_receipt,
            peer: Box::new(peer_outcome),
        },
    })
}

/// What a Deriver's tenant-root creation needs from its host.
///
/// Cloudflare implements it with the Worker's Env and Secret bindings, the
/// role-private D1 database, the managed-backup R2 bucket, the peer Deriver's
/// Service Binding and the creation Durable Object. A VM Deriver implements it
/// with its role-private env file and SQLite, and HTTP to its peers. The
/// ceremony itself (admission, finalization, sealing, persistence and every
/// check) is the same code on both.
#[allow(async_fn_in_trait)]
pub trait TenantRootDeriverHostV1:
    crate::TenantRootServiceTransportV1 + TenantRootCreationStateTransportV1
{
    /// The role-private SQL session the role store runs on.
    type Sql: RoleSqlSessionV1;
    /// The role's Env and Secret bindings.
    type Env: crate::CloudflareEnvReaderV1 + crate::CloudflareSecretReaderV1;

    /// The Deriver role this host serves.
    fn worker_role(&self) -> crate::CloudflareWorkerRoleV1;
    /// Current host time in Unix milliseconds, for a step that must read the
    /// clock again after its request began.
    fn now_ms(&self) -> RouterAbProtocolResult<u64>;
    /// `W` on this host. It only decides when recovery cancels an unsettled
    /// admission; the cancellation is what permits erasure.
    fn admission_recovery_window_ms(&self) -> RouterAbProtocolResult<u64> {
        Ok(TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_V1)
    }
    /// Asks the wallet object that holds one pair session for its outcome
    /// and, when `fence` is set, to fence the pair unless it is claimed or
    /// completed. A host that keeps pairs only in its role store has no
    /// wallet objects, and its admissions never name one.
    async fn reconcile_wallet_object_pair(
        &self,
        pair_object_id: &str,
        request: &crate::tenant_root_role_d1::TenantRootWalletPairReconcileRequestV1,
    ) -> RouterAbProtocolResult<crate::tenant_root_role_d1::TenantRootWalletPairReconciliationV1> {
        let _ = (pair_object_id, request);
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "this Deriver host keeps no wallet objects",
        ))
    }
    /// The role's Env and Secret bindings.
    fn env(&self) -> &Self::Env;
    /// Opens the role's private role-share store for one operation.
    fn role_store(&self) -> RoleStoreResult<TenantRootRoleShareStoreV1<Self::Sql>>;
    /// Stores one verified managed backup at its coordinates and returns the
    /// stored object's metadata. A replay of the identical artifact succeeds
    /// with the metadata of the original write. Different bytes at the same
    /// coordinates are refused, unless their digest is in `replaceable`: the
    /// exact backup of a superseded refresh attempt, replaced only as that
    /// stored version.
    async fn put_managed_backup(
        &self,
        backup: &VerifiedTenantRootManagedBackupV1,
        replaceable: &[[u8; 32]],
    ) -> RouterAbProtocolResult<crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1>;
    /// Loads the managed backup at its coordinates and verifies it against the
    /// role's trusted verifying key.
    async fn get_managed_backup(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<VerifiedTenantRootManagedBackupV1>;
    /// Loads and verifies the managed backup at its coordinates, with the
    /// metadata of the stored object.
    async fn get_managed_backup_with_metadata(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<(VerifiedTenantRootManagedBackupV1, crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1)>;
    /// Deletes the managed backup and provider canary at these coordinates and
    /// proves both are absent afterwards.
    async fn delete_managed_backup(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootManagedBackupDeletionReceiptV1>;
    /// Stores the role's signed provider-canary receipt beside its managed
    /// backup, at the same coordinates, after verifying it against the role's
    /// key. A replay of the identical receipt succeeds. A different receipt at
    /// the same coordinates is refused, unless its digest is in `replaceable`,
    /// as for the managed backup.
    async fn put_provider_canary(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
        canary_bytes: &[u8],
        trusted_role_verifying_key: &[u8; 32],
        replaceable: &[[u8; 32]],
    ) -> RouterAbProtocolResult<crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1>;
    /// Loads the provider-canary receipt at these coordinates, verified against
    /// the role's key, as its exact canonical bytes.
    async fn get_provider_canary(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<Vec<u8>>;
    /// Loads the provider-canary receipt at these coordinates, verified against
    /// the expected binding and the role's key, with the stored object's
    /// metadata.
    async fn get_provider_canary_with_metadata(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
        expected_binding: &router_ab_core::TenantRootProviderCanaryReceiptBindingV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<(router_ab_core::VerifiedTenantRootProviderCanaryReceiptV1, crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1)>;
}

/// Admits one root-using operation, named by its authenticated custody
/// binding, on the binding's epoch at this Deriver, without reading the
/// share. An operation that starts before its first root read calls this at
/// its start, so a refresh that retires the epoch meanwhile does not stop it.
pub async fn tenant_root_deriver_admit_bound_work_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    authenticated_custody_binding: &router_ab_core::TenantRootCustodyBindingV1,
    attempt: &crate::tenant_root_role_d1::TenantRootRootUseAttemptV1,
    now_ms: u64,
) -> RouterAbProtocolResult<()> {
    let store = host.role_store().map_err(|error| {
        crate::map_cloudflare_tenant_root_role_store_error_v1("tenant-root role store lookup", error)
    })?;
    match store
        .admit_bound(authenticated_custody_binding, attempt, now_ms)
        .await
        .map_err(|error| {
            crate::map_cloudflare_tenant_root_role_store_error_v1(
                "tenant-root root-use admission",
                error,
            )
        })? {
        crate::tenant_root_role_d1::TenantRootRootUseAdmissionV1::Admitted => Ok(()),
        crate::tenant_root_role_d1::TenantRootRootUseAdmissionV1::EpochClosed => {
            Err(tenant_root_epoch_closed_error_v1())
        }
        crate::tenant_root_role_d1::TenantRootRootUseAdmissionV1::NotYetActive => {
            Err(tenant_root_epoch_not_yet_active_error_v1())
        }
        crate::tenant_root_role_d1::TenantRootRootUseAdmissionV1::AttemptConflict => {
            Err(tenant_root_attempt_conflict_error_v1())
        }
        crate::tenant_root_role_d1::TenantRootRootUseAdmissionV1::Cancelled => {
            Err(tenant_root_attempt_cancelled_error_v1())
        }
        crate::tenant_root_role_d1::TenantRootRootUseAdmissionV1::Erased => {
            Err(tenant_root_epoch_erased_error_v1())
        }
    }
}

/// The attempt settled here and its retired epoch has since been erased, so
/// a late step of it can read nothing. The operation itself can start again.
pub(super) fn tenant_root_epoch_erased_error_v1() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
        "the tenant-root epoch this operation is bound to was erased here after the operation settled; start it again",
    )
}

/// Recovery cancelled this attempt here after it stayed unsettled; its
/// epoch may be erased, so it can take no further step. A new attempt can.
pub(super) fn tenant_root_attempt_cancelled_error_v1() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
        "this tenant-root operation's admission was cancelled here after it stayed unsettled; start it again",
    )
}

/// A retry of an admitted attempt must carry its binding apart from the
/// window. A Yao pair session stays on the epoch it was admitted on; work
/// after a refresh needs a new ceremony.
pub(super) fn tenant_root_attempt_conflict_error_v1() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::ConflictingPair,
        "this tenant-root operation was admitted here under a different binding; a new attempt is required",
    )
}

pub(super) async fn unsettled_root_use_admissions_v1<S: RoleSqlSessionV1>(
    store: &TenantRootRoleShareStoreV1<S>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    epoch: TenantRootShareEpoch,
) -> RouterAbProtocolResult<u64> {
    store
        .unsettled_root_use_admissions(identity_digest, custody_lineage, epoch)
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root unsettled admission count", error))
}

pub(super) async fn cancelled_root_use_admissions_v1<S: RoleSqlSessionV1>(
    store: &TenantRootRoleShareStoreV1<S>,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    epoch: TenantRootShareEpoch,
) -> RouterAbProtocolResult<u64> {
    store
        .cancelled_root_use_admissions(identity_digest, custody_lineage, epoch)
        .await
        .map_err(|error| tenant_root_store_error_v1("tenant-root cancelled admission count", error))
}

/// Asks Deriver B to fence one pair session unless it completed it, for
/// Deriver A's recovery of a claimed attempt. A B that cannot answer leaves
/// the attempt pending: the cleanup is refused and retried.
pub(super) async fn fence_peer_pair_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    identity_digest: TenantRootIdentityDigestV1,
    custody_lineage: TenantRootCustodyLineageId,
    epoch: TenantRootShareEpoch,
    session_hex: &str,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootPeerPairFenceResponseV1> {
    if host.worker_role() != crate::CloudflareWorkerRoleV1::DeriverA {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "only Deriver A's executor claims a pair and needs its peer fenced",
        ));
    }
    host.post_private_json(
        crate::TenantRootServiceTargetV1::Deriver(TwoPartyDeriverRole::DeriverB),
        crate::paths::CLOUDFLARE_DERIVER_TENANT_ROOT_PEER_PAIR_FENCE_PRIVATE_REQUEST_PATH,
        "tenant-root peer pair fence",
        &CloudflareDeriverTenantRootPeerPairFenceRequestV1 {
            identity_digest_b64u: crate::encode_base64url_bytes_v1(identity_digest.as_bytes()),
            custody_lineage_b64u: custody_lineage.to_base64url(),
            epoch: epoch.get().get(),
            session_hex: session_hex.to_owned(),
        },
        None,
    )
    .await
    .map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
            format!(
                "retirement is pending here: Deriver B has not yet fenced a claimed pair; retry: {}",
                error.message()
            ),
        )
    })
}

/// Deriver B fences one pair session for Deriver A's recovery, unless B
/// completed it, and answers only once that is durable.
/// - B completed it: its admission here is settled.
/// - B had only admitted it: the admission is cancelled, so B can neither
///   start nor complete it. In a wallet object, the object fences it first.
/// - B never admitted it: B cannot admit it once its epoch is closed here, so
///   that alone is the fence. While the epoch is still active here, B cannot
///   prove that yet, and A must retry.
pub async fn tenant_root_deriver_fence_peer_pair_v1<Host: TenantRootDeriverHostV1>(
    host: &Host,
    request: CloudflareDeriverTenantRootPeerPairFenceRequestV1,
    now_ms: u64,
) -> RouterAbProtocolResult<CloudflareDeriverTenantRootPeerPairFenceResponseV1> {
    if host.worker_role() != crate::CloudflareWorkerRoleV1::DeriverB {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidRole,
            "only Deriver B fences a pair for its executor's recovery",
        ));
    }
    let (identity_digest, custody_lineage) = crate::tenant_root_control_plane::decode_tenant_root_cleanup_scope_v1(
        &request.identity_digest_b64u,
        &request.custody_lineage_b64u,
    )?;
    if request.session_hex.len() != 64
        || !request
            .session_hex
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MalformedWirePayload,
            "a peer pair fence names a 64-character lowercase hex pair session",
        ));
    }
    let store = host
        .role_store()
        .map_err(|error| tenant_root_store_error_v1("tenant-root role store lookup", error))?;
    let fence_error = |error| tenant_root_store_error_v1("tenant-root peer pair fence", error);
    let admission = store
        .yao_admission(identity_digest, custody_lineage, &request.session_hex)
        .await
        .map_err(fence_error)?;
    let Some(admission) = admission else {
        let active = store
            .lineage_active_epoch(identity_digest, custody_lineage)
            .await
            .map_err(fence_error)?;
        return match active {
            Some(active) if active > request.epoch => {
                Ok(CloudflareDeriverTenantRootPeerPairFenceResponseV1::Fenced)
            }
            _ => Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
                "Deriver B cannot yet prove it will never start this pair: its epoch is still active here; retry",
            )),
        };
    };
    match (admission.status.as_str(), admission.pair_object_id) {
        ("settled", _) => Ok(CloudflareDeriverTenantRootPeerPairFenceResponseV1::Completed),
        ("cancelled", _) => Ok(CloudflareDeriverTenantRootPeerPairFenceResponseV1::Fenced),
        ("admitted", None) => {
            store
                .cancel_yao_admission(identity_digest, custody_lineage, &request.session_hex, false)
                .await
                .map_err(fence_error)?;
            // The cancellation races B's own completion; the row says which
            // one won.
            let settled = store
                .yao_admission(identity_digest, custody_lineage, &request.session_hex)
                .await
                .map_err(fence_error)?;
            match settled.as_ref().map(|admission| admission.status.as_str()) {
                Some("settled") => Ok(CloudflareDeriverTenantRootPeerPairFenceResponseV1::Completed),
                Some("cancelled") => Ok(CloudflareDeriverTenantRootPeerPairFenceResponseV1::Fenced),
                _ => Err(RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    "Deriver B's admission neither settled nor cancelled",
                )),
            }
        }
        ("admitted", Some(pair_object_id)) => {
            let reconciliation = host
                .reconcile_wallet_object_pair(
                    &pair_object_id,
                    &crate::tenant_root_role_d1::TenantRootWalletPairReconcileRequestV1 {
                        session_hex: request.session_hex.clone(),
                        fence: true,
                        peer_settled: false,
                        now_ms,
                    },
                )
                .await?;
            store
                .record_wallet_object_reconciliation(
                    &request.session_hex,
                    &pair_object_id,
                    reconciliation,
                )
                .await
                .map_err(fence_error)?;
            match reconciliation {
                crate::tenant_root_role_d1::TenantRootWalletPairReconciliationV1::Completed => {
                    Ok(CloudflareDeriverTenantRootPeerPairFenceResponseV1::Completed)
                }
                crate::tenant_root_role_d1::TenantRootWalletPairReconciliationV1::Fenced => {
                    Ok(CloudflareDeriverTenantRootPeerPairFenceResponseV1::Fenced)
                }
                crate::tenant_root_role_d1::TenantRootWalletPairReconciliationV1::Claimed
                | crate::tenant_root_role_d1::TenantRootWalletPairReconciliationV1::Open => {
                    Err(RouterAbProtocolError::new(
                        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                        "Deriver B's wallet object neither fenced nor completed the pair",
                    ))
                }
            }
        }
        _ => Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "Deriver B's admission has a status only Deriver A's executor records",
        )),
    }
}

/// A wallet object that could not answer leaves its admission pending; the
/// cleanup is retried.
#[cfg(any(feature = "strict-worker-deriver-a-entrypoint", feature = "strict-worker-deriver-b-entrypoint"))]
pub(super) fn wallet_object_unreachable_error_v1(error: worker::Error) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
        format!("the wallet object holding a pair could not be reconciled; retry: {error}"),
    )
}

/// The Worker env key that sets `W` in milliseconds on a Cloudflare Deriver,
/// at least one second. Unset, `W` is
/// [`TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_V1`].
pub(crate) const TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_ENV_V1: &str =
    "TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS";

/// `W`: how long after admission an unsettled root-use admission is left
/// before recovery cancels it. It triggers recovery and never by itself
/// permits erasure; the cancellation is the fence that does. Every root-bound
/// authorization lives at most this long.
pub const TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_V1: u64 =
    router_ab_core::TENANT_ROOT_MAX_LIFETIME_MS_V1;

/// The binding cannot be used again, but the operation can: admitted afresh,
/// it is bound to the new epoch. So the refusal is retryable for the caller.
pub(super) fn tenant_root_epoch_closed_error_v1() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
        "the tenant-root epoch this operation is bound to was retired here before the operation was admitted; start it again",
    )
}

pub(super) fn tenant_root_epoch_not_yet_active_error_v1() -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
        "the tenant-root epoch this operation is bound to is not yet active at this Deriver; retry",
    )
}

/// The Cloudflare Deriver host.
#[cfg(feature = "workers-rs")]
pub(crate) struct CloudflareTenantRootDeriverHostV1<'a> {
    pub(super) env: &'a worker::Env,
    pub(super) reader: crate::CloudflareWorkerEnvReaderV1<'a>,
    pub(super) worker_role: crate::CloudflareWorkerRoleV1,
    pub(super) transport: crate::tenant_root_transport::CloudflareTenantRootServiceTransportV1<'a>,
    pub(super) creation_state:
        crate::durable_object::tenant_root_creation::CloudflareTenantRootCreationStateTransportV1<'a>,
}

#[cfg(feature = "workers-rs")]
impl<'a> CloudflareTenantRootDeriverHostV1<'a> {
    pub(crate) fn new(
        env: &'a worker::Env,
        worker_role: crate::CloudflareWorkerRoleV1,
        peer_binding: Option<&'a crate::CloudflarePeerBindingV1>,
    ) -> Self {
        let transport = match peer_binding {
            Some(peer) => crate::tenant_root_transport::CloudflareTenantRootServiceTransportV1::peer(
                env, peer,
            ),
            None => crate::tenant_root_transport::CloudflareTenantRootServiceTransportV1::new(
                env, None, None,
            ),
        };
        Self {
            env,
            reader: crate::CloudflareWorkerEnvReaderV1::new(env),
            worker_role,
            transport,
            creation_state:
                crate::durable_object::tenant_root_creation::CloudflareTenantRootCreationStateTransportV1::new(env),
        }
    }

    /// The Worker's bindings, for a capability only Cloudflare provides.
    pub(crate) fn worker_env(&self) -> &'a worker::Env {
        self.env
    }

    pub(super) fn backup_store(
        &self,
    ) -> RouterAbProtocolResult<crate::tenant_root_managed_backup_r2::CloudflareTenantRootManagedBackupStoreV1>
    {
        let role = tenant_root_creation_protocol_role_v1(self.worker_role)?;
        crate::tenant_root_managed_backup_r2::CloudflareTenantRootManagedBackupStoreV1::from_env(
            self.env,
            tenant_root_managed_restore_role_v1(role),
        )
        .map_err(|error| tenant_root_store_error_v1("tenant-root backup store lookup", error))
    }
}

#[cfg(feature = "workers-rs")]
impl crate::TenantRootServiceTransportV1 for CloudflareTenantRootDeriverHostV1<'_> {
    async fn post_private_json<TRequest: serde::Serialize, TResponse: serde::de::DeserializeOwned>(
        &self,
        target: crate::TenantRootServiceTargetV1,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        bounds: Option<crate::TenantRootCallBoundsV1>,
    ) -> RouterAbProtocolResult<TResponse> {
        self.transport
            .post_private_json(target, path, label, request, bounds)
            .await
    }
}

#[cfg(feature = "workers-rs")]
impl TenantRootCreationStateTransportV1 for CloudflareTenantRootDeriverHostV1<'_> {
    fn creation_authority_id(
        &self,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
    ) -> RouterAbProtocolResult<TenantRootControlPlaneAuthorityIdV1> {
        self.creation_state
            .creation_authority_id(identity_digest, custody_lineage)
    }

    async fn creation_state_call<TRequest: serde::Serialize, TResponse: serde::de::DeserializeOwned>(
        &self,
        authority_id: TenantRootControlPlaneAuthorityIdV1,
        identity_digest: TenantRootIdentityDigestV1,
        custody_lineage: TenantRootCustodyLineageId,
        path: &'static str,
        label: &'static str,
        request: &TRequest,
        request_max_bytes: usize,
        response_max_bytes: usize,
    ) -> RouterAbProtocolResult<TResponse> {
        self.creation_state
            .creation_state_call(
                authority_id,
                identity_digest,
                custody_lineage,
                path,
                label,
                request,
                request_max_bytes,
                response_max_bytes,
            )
            .await
    }
}

#[cfg(feature = "workers-rs")]
impl<'a> TenantRootDeriverHostV1 for CloudflareTenantRootDeriverHostV1<'a> {
    type Sql = crate::tenant_root_role_sql::D1RoleSqlSessionV1;
    type Env = crate::CloudflareWorkerEnvReaderV1<'a>;

    fn worker_role(&self) -> crate::CloudflareWorkerRoleV1 {
        self.worker_role
    }

    fn now_ms(&self) -> RouterAbProtocolResult<u64> {
        crate::cloudflare_now_unix_ms_v1()
    }

    fn admission_recovery_window_ms(&self) -> RouterAbProtocolResult<u64> {
        use crate::CloudflareEnvReaderV1 as _;
        match self
            .reader
            .get_text(TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_ENV_V1)?
        {
            Some(value) => value.parse::<u64>().ok().filter(|value| *value >= 1_000).ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                    "the admission recovery window must be at least 1000 milliseconds",
                )
            }),
            None => Ok(TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS_V1),
        }
    }

    async fn reconcile_wallet_object_pair(
        &self,
        pair_object_id: &str,
        request: &crate::tenant_root_role_d1::TenantRootWalletPairReconcileRequestV1,
    ) -> RouterAbProtocolResult<crate::tenant_root_role_d1::TenantRootWalletPairReconciliationV1> {
        #[cfg(feature = "strict-worker-deriver-a-entrypoint")]
        if matches!(self.worker_role, crate::CloudflareWorkerRoleV1::DeriverA) {
            return crate::durable_object::reconcile_deriver_a_wallet_pair_v1(
                self.env,
                pair_object_id,
                request,
            )
            .await
            .map_err(wallet_object_unreachable_error_v1);
        }
        #[cfg(feature = "strict-worker-deriver-b-entrypoint")]
        if matches!(self.worker_role, crate::CloudflareWorkerRoleV1::DeriverB) {
            return crate::durable_object::reconcile_deriver_b_wallet_pair_v1(
                self.env,
                pair_object_id,
                request,
            )
            .await
            .map_err(wallet_object_unreachable_error_v1);
        }
        let _ = (pair_object_id, request);
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "this Deriver build keeps no wallet objects",
        ))
    }

    fn env(&self) -> &Self::Env {
        &self.reader
    }

    fn role_store(&self) -> RoleStoreResult<TenantRootRoleShareStoreV1<Self::Sql>> {
        CloudflareTenantRootRoleShareStoreV1::from_env(self.env)
    }

    async fn put_managed_backup(
        &self,
        backup: &VerifiedTenantRootManagedBackupV1,
        replaceable: &[[u8; 32]],
    ) -> RouterAbProtocolResult<crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1> {
        self.backup_store()?
            .put_verified(backup, replaceable)
            .await
            .map(|outcome| outcome.metadata().clone())
            .map_err(|error| tenant_root_store_error_v1("tenant-root backup persistence", error))
    }

    async fn get_managed_backup_with_metadata(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<(VerifiedTenantRootManagedBackupV1, crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1)> {
        self.backup_store()?
            .get_verified_with_metadata(coordinates, trusted_role_verifying_key)
            .await
            .map_err(|error| tenant_root_store_error_v1("tenant-root backup lookup", error))
    }

    async fn get_managed_backup(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<VerifiedTenantRootManagedBackupV1> {
        self.backup_store()?
            .get_verified(coordinates, trusted_role_verifying_key)
            .await
            .map_err(|error| tenant_root_store_error_v1("tenant-root backup lookup", error))
    }

    async fn delete_managed_backup(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
    ) -> RouterAbProtocolResult<CloudflareTenantRootManagedBackupDeletionReceiptV1> {
        self.backup_store()?
            .delete_coordinates(coordinates)
            .await
            .map_err(|error| tenant_root_store_error_v1("tenant-root backup cleanup", error))
    }

    async fn put_provider_canary(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
        canary_bytes: &[u8],
        trusted_role_verifying_key: &[u8; 32],
        replaceable: &[[u8; 32]],
    ) -> RouterAbProtocolResult<crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1> {
        let signed = TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(canary_bytes)
            .map_err(candidate_derivation_error)?;
        self.backup_store()?
            .put_verified_provider_canary(
                coordinates,
                canary_bytes,
                signed.binding(),
                trusted_role_verifying_key,
                replaceable,
            )
            .await
            .map(|outcome| outcome.metadata().clone())
            .map_err(|error| {
                tenant_root_store_error_v1("tenant-root provider canary persistence", error)
            })
    }

    async fn get_provider_canary(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<Vec<u8>> {
        let bytes = self
            .backup_store()?
            .get_provider_canary_bytes(coordinates)
            .await
            .map_err(|error| tenant_root_store_error_v1("tenant-root provider canary lookup", error))?;
        crate::tenant_root_managed_backup_r2::verify_tenant_root_provider_canary_object_v1(
            &bytes,
            coordinates,
            trusted_role_verifying_key,
        )
        .map_err(|error| RouterAbProtocolError::new(RouterAbProtocolErrorCode::ForbiddenLocalBinding, error))?;
        Ok(bytes)
    }

    async fn get_provider_canary_with_metadata(
        &self,
        coordinates: crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectCoordinatesV1,
        expected_binding: &router_ab_core::TenantRootProviderCanaryReceiptBindingV1,
        trusted_role_verifying_key: &[u8; 32],
    ) -> RouterAbProtocolResult<(router_ab_core::VerifiedTenantRootProviderCanaryReceiptV1, crate::tenant_root_managed_backup_r2::TenantRootManagedBackupObjectMetadataV1)> {
        self.backup_store()?
            .get_verified_provider_canary_with_metadata(
                coordinates,
                expected_binding,
                trusted_role_verifying_key,
            )
            .await
            .map_err(|error| tenant_root_store_error_v1("tenant-root provider canary lookup", error))
    }
}

/// Drives the peer Deriver through this Deriver's host.
pub(super) struct TenantRootCreationPeerV1<'a, Host: TenantRootDeriverHostV1> {
    pub(super) host: &'a Host,
    pub(super) expected_role: TwoPartyDeriverRole,
    pub(super) initiator_command: VerifiedTenantRootRoleCreationCommandV1,
    pub(super) initiator_context: TenantRootCeremonyContextV1,
    pub(super) role_keys: &'a TenantRootCreationRoleVerifyingKeysV1,
}

impl<Host: TenantRootDeriverHostV1> TenantRootPeerRoleDriverV1 for TenantRootCreationPeerV1<'_, Host> {
    async fn drive_peer(
        &mut self,
        peer_package_bytes: &[u8],
        initiator_signed_commitment: &[u8],
    ) -> RouterAbProtocolResult<TenantRootPeerRoleOutcomeV1> {
        let commitment = decode_verified_creation_commitment_v1(
            initiator_signed_commitment,
            &self.initiator_context,
            self.initiator_command.role(),
            self.role_keys,
        )?;
        tenant_root_creation_commitment_call_v1(
            self.host,
            self.role_keys,
            &self.initiator_command,
            &commitment,
        )
        .await?;
        let request = CloudflareDeriverTenantRootCreateRoleShareRequestV1::PeerCompletion {
            role_creation_command_package_b64u: crate::encode_base64url_bytes_v1(
                peer_package_bytes,
            ),
            initiator_signed_commitment_b64u: crate::encode_base64url_bytes_v1(
                initiator_signed_commitment,
            ),
        };
        let response = crate::tenant_root_transport::tenant_root_deriver_create_role_share_call_v1(
            self.host,
            self.expected_role,
            &request,
        )
        .await?;
        let CloudflareDeriverTenantRootCreateRoleShareResponseV1::PeerCompleted {
            role,
            signed_commitment_b64u,
            signed_installation_evidence_b64u,
            signed_managed_backup_b64u,
            terminal_receipt_b64u,
            provider_canary_receipt_b64u,
        } = response
        else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "tenant-root creation peer returned an initiator-only response",
            ));
        };
        if role != CloudflareTenantRootCreateRoleV1::from_protocol(self.expected_role) {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ForbiddenLocalBinding,
                "tenant-root creation peer response came from the wrong Deriver role",
            ));
        }
        let provider_canary_receipt = crate::decode_base64url_bytes_v1(
            "tenant-root peer provider canary receipt",
            &provider_canary_receipt_b64u,
        )?;
        TenantRootSignedProviderCanaryReceiptV1::decode_canonical_bytes(&provider_canary_receipt)
            .map_err(candidate_derivation_error)?;
        Ok(TenantRootPeerRoleOutcomeV1 {
            signed_commitment: crate::decode_base64url_bytes_v1(
                "tenant-root peer signed commitment",
                &signed_commitment_b64u,
            )?,
            signed_installation_evidence: crate::decode_base64url_bytes_v1(
                "tenant-root peer signed installation evidence",
                &signed_installation_evidence_b64u,
            )?,
            signed_managed_backup: crate::decode_base64url_bytes_v1(
                "tenant-root peer signed managed backup",
                &signed_managed_backup_b64u,
            )?,
            provider_canary_receipt,
            terminal_receipt: crate::decode_base64url_bytes_v1(
                "tenant-root peer terminal receipt",
                &terminal_receipt_b64u,
            )?,
        })
    }
}
