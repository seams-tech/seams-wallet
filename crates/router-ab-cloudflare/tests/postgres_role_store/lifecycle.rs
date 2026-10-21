use super::*;
use router_ab_core::derivation::TenantRootRetentionKeyIdV1;
use router_ab_core::{
    TenantRootManagedRestoreAvailableV1, TenantRootManagedRestoreCapabilityV1,
    TenantRootRestoreImportKeypairV1, TenantRootRoleUnavailableReceiptV1,
    TenantRootSignedManagedRestoreCapabilityV1, TenantRootSourceRetirementCommandV1,
};

pub(super) async fn restore_pending(
    store: &Store,
    admin: &Client,
    active: &CloudflareStoredTenantRootRoleShareV1,
) -> CloudflareStoredTenantRootRoleShareV1 {
    let role = store.cipher.role;
    let original = test_active_refresh_state();
    assert_eq!(
        original.current().activation().digest(),
        active
            .active_binding()
            .expect("stored active binding")
            .activation_receipt_digest()
    );
    let unavailable = TenantRootManagedRestoreAvailableV1::new(original.clone())
        .expect("restore availability")
        .mark_role_unavailable(
            TenantRootRoleUnavailableReceiptV1::new(
                lifecycle_receipt(0x90).expect("unavailability receipt"),
                role.managed_restore_role(),
                44,
            )
            .expect("unavailability"),
        )
        .expect("unavailable role");
    let capability = TenantRootManagedRestoreCapabilityV1::new(
        lifecycle_receipt(0x91).expect("capability digest"),
        original.identity().digest().expect("identity"),
        original.custody_lineage(),
        role.managed_restore_role(),
        epoch(1),
        original.current().activation().digest(),
        45,
        100,
    )
    .expect("restore capability");
    let key = SigningKey::from_bytes(&[0x92; 32]);
    let verified = TenantRootSignedManagedRestoreCapabilityV1::sign(
        capability,
        "postgres-restore-issuer",
        key.as_bytes(),
    )
    .expect("signed restore capability")
    .verify(
        &unavailable,
        "postgres-restore-issuer",
        key.verifying_key().as_bytes(),
    )
    .expect("verified restore capability");
    let context = test_creation_context();
    let evidence = test_initial_creation_evidence(&context, core_role(role));
    let scalar = match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => 17,
        CloudflareTenantRootDeriverRoleV1::DeriverB => 29,
    };
    let backup = test_verified_managed_backup(&context, core_role(role), scalar, 0x88, &evidence);
    let share = SigningRootShare::from_canonical_bytes(
        core_role(role).share_id(),
        Scalar::from(scalar).to_bytes(),
    )
    .expect("backup plaintext");
    let opened = backup
        .verify_opened_share(
            MpcPrfSigningRootShareWireV1::new(
                SigningRootShareWire::from_share(&share).to_bytes().to_vec(),
            )
            .expect("backup share wire"),
        )
        .expect("opened backup");
    let sealed = test_sealed_online_share(&context, &evidence, core_role(role));
    let staging = CloudflareTenantRootManagedRestoreStagingInputV1::from_verified_material(
        verified,
        opened,
        test_identity(),
        sealed,
        scope(&active.record, 0x77),
        45,
    )
    .expect("managed-restore staging input");
    admin
        .execute(
            "DELETE FROM tenant_root_role_shares WHERE tenant_root_share_epoch = 1",
            &[],
        )
        .await
        .expect("simulate role-store loss");
    let command = match store
        .reserve_managed_restore_staging(staging, 45)
        .await
        .expect("reserve restore")
    {
        CloudflareTenantRootManagedRestoreStagingDecisionV1::Execute { command } => command,
        _ => panic!("fresh restore must execute"),
    };
    let (pending, _) = store
        .insert_managed_restore_pending(command, 46)
        .await
        .expect("persist recovered pending share");
    assert!(matches!(
        pending.record.lifecycle(),
        CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
    ));
    assert!(matches!(
        store
            .observe_active(&test_identity())
            .await
            .expect("restored role cannot derive"),
        CloudflareTenantRootActiveRoleShareV1::Unprovisioned
    ));
    pending
}

pub(super) async fn forward_refresh(
    store: &Store,
    restored: CloudflareStoredTenantRootRoleShareV1,
    pair: &TenantRootActiveRootPairV1,
    current: &TenantRootEpochCommitmentsV1,
) -> (
    CloudflareStoredTenantRootRoleShareV1,
    VerifiedTenantRootSignedActivationReceiptV1,
) {
    let pending = successor_pending(store, pair).await;
    let provenance = store
        .managed_restore_forward_refresh_provenance(&restored)
        .expect("authenticated restore provenance");
    let (activation, retained) = refresh_activation(&pending.record, current);
    let command = match store
        .reserve_managed_restore_forward_refresh(
            scope(&pending.record, 0x73),
            restored,
            pending,
            activation.clone(),
            provenance.capability_digest,
            provenance.backup_receipt_digest,
            provenance.installation_receipt_digest,
            60,
            59,
        )
        .await
        .expect("reserve mandatory forward refresh")
    {
        CloudflareTenantRootManagedRestoreForwardRefreshDecisionV1::Execute { command } => command,
        _ => panic!("forward refresh must execute"),
    };
    let (active, executed) = store
        .execute_managed_restore_forward_refresh(command, 60)
        .await
        .expect("atomic recovered-source deletion and activation");
    let receipt = success_receipt(&executed, activation.activation_receipt_bytes(), 61);
    store
        .complete_managed_restore_forward_refresh(executed, &activation, receipt)
        .await
        .expect("complete forward refresh");
    assert!(store
        .load_epoch(&test_identity(), active.record.custody_lineage(), epoch(1))
        .await
        .expect("consumed restore row")
        .is_none());
    (active, retained)
}

pub(super) async fn cleanup_retired(
    store: &Store,
    retired: &CloudflareStoredTenantRootRoleShareV1,
    active: &CloudflareStoredTenantRootRoleShareV1,
) {
    let target = TenantRootRoleCleanupTargetV1::Retired {
        identity_digest: test_identity().digest().expect("identity"),
        custody_lineage: retired.record.custody_lineage(),
        role: core_role(store.cipher.role),
        retired_epoch: retired.record.epoch(),
        expected_retired_revision: retired.revision(),
        expected_active_epoch: active.record.epoch(),
        expected_active_revision: active.revision(),
    };
    let key = SigningKey::from_bytes(&[0x93; 32]);
    let authority = TenantRootControlPlaneAuthorityIdV1::from_bytes([0x94; 32]);
    let authorization = router_ab_core::TenantRootRoleCleanupCommandV1::sign(
        &target,
        authority,
        TenantRootCeremonyNonceV1::from_bytes([0x95; 32]).expect("cleanup nonce"),
        70,
        100,
        "postgres-cleanup-issuer",
        key.as_bytes(),
    )
    .expect("signed cleanup")
    .verify(
        &target,
        core_role(store.cipher.role),
        authority,
        "postgres-cleanup-issuer",
        key.verifying_key().as_bytes(),
    )
    .expect("verified cleanup");
    let payload = authorization.canonical_bytes().expect("cleanup payload");
    let command = match store
        .reserve_authorized_cleanup(authorization, 70)
        .await
        .expect("reserve cleanup")
    {
        CloudflareTenantRootAuthorizedCleanupDecisionV1::Execute { command } => command,
        _ => panic!("fresh cleanup must execute"),
    };
    let executed = store
        .execute_authorized_cleanup(command, 71)
        .await
        .expect("erase retired epoch");
    let receipt = success_receipt(&executed.executed, &payload, 72);
    store
        .complete_authorized_cleanup(executed, receipt)
        .await
        .expect("cleanup terminal receipt");
    assert!(store
        .load_epoch(
            &test_identity(),
            retired.record.custody_lineage(),
            retired.record.epoch()
        )
        .await
        .expect("erased epoch")
        .is_none());
    assert_eq!(
        store
            .load_epoch(
                &test_identity(),
                active.record.custody_lineage(),
                active.record.epoch()
            )
            .await
            .expect("successor survived"),
        Some(active.clone())
    );
}

pub(super) async fn restore_import_and_retention(
    store: &Store,
    active: &CloudflareStoredTenantRootRoleShareV1,
) {
    let role = store.cipher.role;
    let set_id = TenantRootRecoverySetId::from_bytes([0x96; 16]).expect("recovery set");
    let ikm = [0x97; 32];
    let pair = TenantRootRestoreImportKeypairV1::derive_from_ikm(ikm).expect("import keypair");
    let issued_at_ms = 1_700_000_000_000;
    let root = match decode_activation_receipt_bytes(
        active
            .active_activation_receipt_bytes()
            .expect("activation wire"),
    )
    .expect("receipt")
    .binding()
    {
        TenantRootActivationReceiptBindingV1::RefreshSwap(binding) => {
            *binding.next_commitments().root_commitment()
        }
        _ => panic!("refreshed active root"),
    };
    let binding = CloudflareTenantRootRestoreImportKeyBindingV1::new(
        test_identity().digest().expect("identity"),
        active.record.custody_lineage(),
        TenantRootRestoreSessionIdV1::from_bytes([0x98; 16]).expect("restore session"),
        set_id,
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x99; 32]).expect("destination"),
        [0x9a; 32],
        root,
        active
            .record
            .share_commitment()
            .as_bytes()
            .try_into()
            .expect("share commitment bytes"),
        role,
        1,
        "postgres-import-key",
        [0x9b; 32],
        [0x9c; 32],
        [0x9d; 32],
        pair.public_key(),
        issued_at_ms,
        issued_at_ms + TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1 as u64,
    )
    .expect("import binding");
    let sealed = store
        .seal_restore_import_key_ikm(&binding, &ikm)
        .expect("seal IKM");
    let candidate =
        CloudflareTenantRootRestoreImportKeyRecordV1::new_issued(binding.clone(), sealed)
            .expect("issued-key factory");
    let issued = match store
        .persist_restore_import_key_issue(candidate, issued_at_ms + 1)
        .await
        .expect("persist issuance")
    {
        CloudflareTenantRootRestoreImportKeyIssueDecisionV1::Issued(record) => record,
        _ => panic!("first issuance"),
    };
    assert_eq!(
        *store
            .open_restore_import_key_ikm(&issued)
            .expect("open stored IKM"),
        ikm
    );
    let replay_sealed = store
        .seal_restore_import_key_ikm(&binding, &ikm)
        .expect("fresh replay envelope");
    let replay_candidate =
        CloudflareTenantRootRestoreImportKeyRecordV1::new_issued(binding, replay_sealed)
            .expect("replay issuance factory");
    assert!(matches!(
        store
            .persist_restore_import_key_issue(replay_candidate, issued_at_ms + 2)
            .await
            .expect("issue replay"),
        CloudflareTenantRootRestoreImportKeyIssueDecisionV1::Replay(_)
    ));
    let scalar = match role {
        CloudflareTenantRootDeriverRoleV1::DeriverA => 18_u64,
        CloudflareTenantRootDeriverRoleV1::DeriverB => 31_u64,
    };
    let share = SigningRootShare::from_canonical_bytes(
        core_role(role).share_id(),
        Scalar::from(scalar).to_bytes(),
    )
    .expect("imported share");
    let wire = SigningRootShareWire::from_share(&share).to_bytes();
    let envelope_digest = [0x9e; 32];
    let encrypted = store
        .seal_restore_imported_share(issued.binding(), &envelope_digest, &wire)
        .expect("seal imported share");
    let installed = match store
        .persist_restore_import_key_accept(
            &issued,
            envelope_digest,
            encrypted,
            [0x9f; 32],
            issued_at_ms + 3,
        )
        .await
        .expect("install imported share")
    {
        CloudflareTenantRootRestoreImportKeyAcceptDecisionV1::Accepted(record) => record,
        _ => panic!("first acceptance"),
    };
    assert_eq!(
        SigningRootShareWire::from_share(
            &store
                .open_restore_imported_share(&installed)
                .expect("reopen imported share")
        )
        .to_bytes(),
        wire
    );
    store
        .close_restore_import_session_secrets(
            installed.binding.identity_digest,
            installed.binding.custody_lineage,
            installed.binding.restore_session_id,
            issued_at_ms + 4,
        )
        .await
        .expect("erase import ciphertexts");
    let closed = store
        .load_restore_import_key_by_replay([0x9b; 32])
        .await
        .expect("closed key")
        .expect("closed record");
    assert_eq!(
        closed.lifecycle(),
        CloudflareTenantRootRestoreImportKeyLifecycleV1::Closed
    );
    assert!(store.open_restore_imported_share(&closed).is_err());
    let id = TenantRootRetentionKeyIdV1::new(
        set_id,
        core_role(role),
        std::num::NonZeroU64::new(3_000_000_001).expect("64-bit key version"),
    );
    store
        .provision_recovery_retention_key(id, &[0xa0; 32])
        .await
        .expect("provision encrypted retention key");
    let first = store
        .recovery_retention_key(id)
        .await
        .expect("retention lookup")
        .expect("retained key");
    let encrypted = first
        .seal(b"postgres-e2e", b"recovery package", [0xa1; 12])
        .expect("retention encryption");
    store
        .provision_recovery_retention_key(id, &[0xa2; 32])
        .await
        .expect("provision replay");
    let replay = store
        .recovery_retention_key(id)
        .await
        .expect("retention replay")
        .expect("original key retained");
    assert_eq!(
        replay
            .open(b"postgres-e2e", &encrypted)
            .expect("original key opens ciphertext")
            .as_slice(),
        b"recovery package"
    );
    store
        .delete_recovery_retention_key(id)
        .await
        .expect("delete retention key");
    assert!(store
        .recovery_retention_key(id)
        .await
        .expect("deleted retention lookup")
        .is_none());
}

pub(super) async fn source_retirement(
    store: &Store,
    active: &CloudflareStoredTenantRootRoleShareV1,
    receipt: VerifiedTenantRootSignedActivationReceiptV1,
) {
    let key = SigningKey::from_bytes(&[0xa3; 32]);
    let now = 1_700_000_000_100;
    let command = TenantRootSourceRetirementCommandV1::sign(
        &receipt,
        core_role(store.cipher.role),
        TenantRootProtocolDigestV1::from_bytes([0xa4; 32]).expect("destination receipt"),
        TenantRootCeremonyNonceV1::from_bytes([0xa5; 32]).expect("retirement nonce"),
        now,
        now + 100,
        "postgres-source-retirement",
        key.as_bytes(),
    )
    .expect("signed retirement")
    .verify(
        core_role(store.cipher.role),
        "postgres-source-retirement",
        key.verifying_key().as_bytes(),
        now,
    )
    .expect("verified retirement");
    assert_eq!(
        store
            .retire_source_lineage(&command, now)
            .await
            .expect("retire source"),
        now as i64
    );
    assert_eq!(
        store
            .retire_source_lineage(&command, now + 1)
            .await
            .expect("retirement replay"),
        now as i64
    );
    assert!(store
        .load_epoch(&test_identity(), active.record.custody_lineage(), epoch(2))
        .await
        .expect("retired source")
        .is_none());
    let pending = record_for_identity_epoch(
        test_identity(),
        store.cipher.role,
        0x44,
        epoch(3),
        test_commitment(store.cipher.role),
    );
    assert!(
        store
            .reserve_insert_pending(scope(&pending, 0xa6), pending, now + 2)
            .await
            .is_err(),
        "retirement trigger rejects a late command"
    );
}
