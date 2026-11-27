//! Record wire round trips, provenance digests and lifecycle ordering tests.

use super::*;

#[test]
fn managed_restore_provenance_changes_the_replay_payload_digest() {
    let ceremony = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let mut restore = ceremony.clone();
    let installation_evidence_digest =
        record_installation_evidence_digest(&restore).expect("installation evidence digest");
    restore.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Pending(
        CloudflareTenantRootPendingShareV1::from_managed_restore(
            installation_evidence_digest,
            lifecycle_receipt(0x93).expect("capability digest"),
            lifecycle_receipt(0x94).expect("backup receipt digest"),
            30,
        )
        .expect("managed-restore pending state"),
    );
    restore.updated_at_ms = 30;
    let ceremony_digest =
        insert_pending_payload_digest(&ceremony, 1).expect("ceremony insertion payload digest");
    let restore_digest =
        insert_pending_payload_digest(&restore, 1).expect("restore insertion payload digest");
    assert_ne!(ceremony_digest, restore_digest);
}

#[test]
fn activation_wire_round_trip_rederives_projection_from_exact_bytes() {
    let activation =
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
    let wire_value = serde_json::json!({
        "availability": serde_json::to_value(&activation.availability)
            .expect("availability JSON"),
        "activation_receipt_b64u": encode_base64url_bytes_v1(
            activation.activation_receipt_bytes()
        ),
    });
    let decoded = serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(wire_value)
        .expect("activation wire");
    let round_tripped = decoded.into_activation().expect("round-tripped activation");
    assert_eq!(
        round_tripped.activation_receipt_bytes(),
        activation.activation_receipt_bytes()
    );
    assert_eq!(
        round_tripped.activation_receipt_digest(),
        activation.activation_receipt_digest()
    );
    assert_eq!(
        round_tripped.activated_at_ms(),
        activation.activated_at_ms()
    );
    let serialized = serde_json::to_value(&round_tripped).expect("activation JSON");
    assert_eq!(
        serialized["activation_receipt_b64u"],
        serde_json::json!(encode_base64url_bytes_v1(
            activation.activation_receipt_bytes()
        ))
    );
    assert!(serialized.get("activation_receipt_digest").is_none());
    assert!(serialized.get("activated_at_ms").is_none());
}

#[test]
fn tenant_held_external_activation_wire_round_trip_retains_exact_provenance() {
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let activation = tenant_held_external_activation_for_record(&pending, 0x81, 20);
    let wire_value = serde_json::json!({
        "availability": serde_json::to_value(&activation.availability)
            .expect("tenant-held external availability JSON"),
        "activation_receipt_b64u": encode_base64url_bytes_v1(
            activation.activation_receipt_bytes()
        ),
    });
    let decoded = serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(wire_value)
        .expect("tenant-held external activation wire");
    let round_tripped = decoded
        .into_activation()
        .expect("round-tripped tenant-held external activation");
    assert_eq!(
        round_tripped.activation_receipt_bytes(),
        activation.activation_receipt_bytes()
    );
    assert_eq!(
        round_tripped.activation_receipt_digest(),
        activation.activation_receipt_digest()
    );
    let CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal { provenance } =
        &round_tripped.availability
    else {
        panic!("expected tenant-held external availability");
    };
    assert_eq!(provenance.recovery_set_id().as_bytes(), &[0x86; 16]);
    assert_eq!(provenance.destination_fingerprint().as_bytes(), &[0x81; 32]);
    let serialized = serde_json::to_value(&round_tripped).expect("activation JSON");
    assert_eq!(
        serialized["availability"]["kind"],
        serde_json::json!("tenant_held_external")
    );
    assert_eq!(
        serialized["availability"]["restore_refresh_command_digest"],
        serde_json::json!(provenance.restore_refresh_command_digest().as_bytes())
    );
    let mut activation_record = pending.clone();
    let receipt = decode_activation_receipt_bytes(round_tripped.activation_receipt_bytes())
        .expect("round-tripped activation receipt");
    let installation_evidence_digest = activation_installation_receipt(
        receipt.binding(),
        activation_record.role().managed_restore_role(),
    );
    activation_record.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Pending(
        CloudflareTenantRootPendingShareV1::from_stored_digest(
            installation_evidence_digest,
            10,
        )
        .expect("external activation pending state"),
    );
    activation_record
        .into_active(round_tripped, 20)
        .expect("tenant-held external activation binds pending role");
}

#[test]
fn tenant_held_external_activation_rejects_provenance_projection_substitution() {
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let activation = tenant_held_external_activation_for_record(&pending, 0x81, 20);
    let mut wire_value = serde_json::json!({
        "availability": serde_json::to_value(&activation.availability)
            .expect("tenant-held external availability JSON"),
        "activation_receipt_b64u": encode_base64url_bytes_v1(
            activation.activation_receipt_bytes()
        ),
    });
    wire_value["availability"]["manifest_digest"][0] = serde_json::json!(0x99);
    let decoded = serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(wire_value)
        .expect("tenant-held external substituted wire shape");
    assert!(decoded.into_activation().is_err());
}

#[test]
fn accepted_loss_activation_wire_round_trip_retains_exact_authorization_digest() {
    let record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let activation = accepted_loss_activation_for_record(&record, 0x61, 0x89, 20);
    let receipt = decode_activation_receipt_bytes(activation.activation_receipt_bytes())
        .expect("accepted-loss activation receipt");
    let (authorization_bytes, authorization_digest) = match receipt.availability() {
        TenantRootActivationReceiptAvailabilityV1::AcceptedPermanentDerivationLoss {
            authorization_bytes,
            authorization_digest,
        } => (authorization_bytes.clone(), *authorization_digest),
        TenantRootActivationReceiptAvailabilityV1::CurrentRoleBackups { .. }
        | TenantRootActivationReceiptAvailabilityV1::TenantHeldExternal { .. } => {
            panic!("expected accepted-loss availability")
        }
    };
    let wire_value = serde_json::json!({
        "availability": serde_json::to_value(&activation.availability)
            .expect("accepted-loss availability JSON"),
        "activation_receipt_b64u": encode_base64url_bytes_v1(
            activation.activation_receipt_bytes()
        ),
    });
    let decoded = serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(wire_value)
        .expect("accepted-loss activation wire");
    let round_tripped = decoded
        .into_activation()
        .expect("round-tripped accepted-loss activation");
    assert_eq!(
        round_tripped.activation_receipt_bytes(),
        activation.activation_receipt_bytes()
    );
    assert_eq!(
        round_tripped.activation_receipt_digest(),
        activation.activation_receipt_digest()
    );
    assert_eq!(
        round_tripped.activated_at_ms(),
        activation.activated_at_ms()
    );
    let CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
        authorization_digest: round_tripped_digest,
        ..
    } = &round_tripped.availability
    else {
        panic!("expected accepted-loss availability");
    };
    assert_eq!(*round_tripped_digest, authorization_digest);
    assert!(!authorization_bytes.is_empty());
    let serialized = serde_json::to_value(&round_tripped).expect("activation JSON");
    assert_eq!(
        serialized["availability"]["kind"],
        serde_json::json!("accepted_permanent_derivation_loss")
    );
    assert_eq!(
        serialized["availability"]["authorization_digest"],
        serde_json::json!(authorization_digest.as_bytes())
    );
    assert_eq!(
        serialized["activation_receipt_b64u"],
        serde_json::json!(encode_base64url_bytes_v1(
            activation.activation_receipt_bytes()
        ))
    );
    assert!(serialized.get("activation_receipt_digest").is_none());
    assert!(serialized.get("activated_at_ms").is_none());
}

#[test]
fn accepted_loss_refresh_activation_round_trip_retains_exact_receipt_bytes() {
    let pending = record_for_identity_epoch(
        test_identity(),
        CloudflareTenantRootDeriverRoleV1::DeriverA,
        0x44,
        epoch(2),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 18),
    );
    let activation = accepted_loss_activation_for_record(&pending, 0x63, 0x89, 40);
    let wire_value = serde_json::json!({
        "availability": serde_json::to_value(&activation.availability)
            .expect("accepted-loss availability JSON"),
        "activation_receipt_b64u": encode_base64url_bytes_v1(
            activation.activation_receipt_bytes()
        ),
    });
    let decoded = serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(wire_value)
        .expect("accepted-loss refresh activation wire");
    let round_tripped = decoded
        .into_activation()
        .expect("round-tripped accepted-loss refresh activation");
    assert_eq!(
        round_tripped.activation_receipt_bytes(),
        activation.activation_receipt_bytes()
    );
    assert_eq!(
        round_tripped.activation_receipt_digest(),
        activation.activation_receipt_digest()
    );
    assert_eq!(
        round_tripped.activated_at_ms(),
        activation.activated_at_ms()
    );
    pending
        .into_active(round_tripped, 40)
        .expect("accepted-loss refresh activation binds pending role");
}

#[test]
fn accepted_loss_activation_rejects_authorization_projection_substitution() {
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let original = accepted_loss_activation_for_record(&pending, 0x61, 0x89, 20);
    let replacement = accepted_loss_activation_for_record(&pending, 0x62, 0x90, 20);
    let active = pending
        .clone()
        .into_active(original.clone(), 20)
        .expect("active record");
    let mut stored = CloudflareStoredTenantRootRoleShareV1 {
        record: active,
        revision: 1,
    };
    {
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
            &mut stored.record.lifecycle
        else {
            panic!("active lifecycle");
        };
        active.activation.activation_receipt_bytes =
            replacement.activation_receipt_bytes.clone();
    }
    assert!(validate_active_stored_record_shape(&stored).is_err());
    {
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
            &mut stored.record.lifecycle
        else {
            panic!("active lifecycle");
        };
        active.activation.activation_receipt_digest = replacement.activation_receipt_digest;
        active.activation.activated_at_ms = replacement.activated_at_ms;
    }
    assert!(validate_active_stored_record_shape(&stored).is_err());
    let original_payload = activate_initial_payload_digest(
        &CloudflareStoredTenantRootRoleShareV1 {
            record: pending,
            revision: 1,
        },
        &original,
        20,
        1,
    )
    .expect("original activation payload");
    let replacement_payload = activate_initial_payload_digest(
        &CloudflareStoredTenantRootRoleShareV1 {
            record: record(CloudflareTenantRootDeriverRoleV1::DeriverA),
            revision: 1,
        },
        &replacement,
        20,
        1,
    )
    .expect("replacement activation payload");
    assert_ne!(original_payload, replacement_payload);
}

#[test]
fn accepted_loss_activation_replay_is_idempotent_and_rejects_authorization_substitution() {
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let pending_stored = CloudflareStoredTenantRootRoleShareV1 {
        record: pending.clone(),
        revision: 1,
    };
    let original = accepted_loss_activation_for_record(&pending, 0x61, 0x89, 20);
    let original_payload = activate_initial_payload_digest(&pending_stored, &original, 20, 1)
        .expect("accepted-loss activation payload");
    let identity = pending.identity().digest().expect("identity digest");
    let key = TenantRootCommandReplayKeyV1::deriver_a(
        identity,
        pending.custody_lineage(),
        TenantRootCeremonySessionIdV1::from_bytes([0x21; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x22; 32]).expect("nonce"),
    );
    let scope = TenantRootCommandScopeV1::new(key, pending.epoch(), 1).expect("scope");
    let command_digest = scope
        .command_digest(TenantRootCommandOperationV1::activate_initial(
            original_payload,
        ))
        .expect("command digest");
    let reservation = match reserve_tenant_root_command_v1(None, key, command_digest, 61)
        .expect("fresh accepted-loss reservation")
    {
        TenantRootCommandReplayDecisionV1::Execute(reservation) => reservation,
        _ => panic!("fresh accepted-loss command must be executable"),
    };
    let stored = TenantRootCommandReplayRecordV1::Reserved(reservation);
    assert!(matches!(
        reserve_tenant_root_command_v1(Some(&stored), key, command_digest, 62)
            .expect("identical accepted-loss replay"),
        TenantRootCommandReplayDecisionV1::InProgress
    ));

    let replacement = accepted_loss_activation_for_record(&pending, 0x62, 0x89, 20);
    let replacement_payload =
        activate_initial_payload_digest(&pending_stored, &replacement, 20, 1)
            .expect("replacement accepted-loss activation payload");
    let replacement_digest = scope
        .command_digest(TenantRootCommandOperationV1::activate_initial(
            replacement_payload,
        ))
        .expect("replacement command digest");
    assert_ne!(command_digest, replacement_digest);
    assert!(
        reserve_tenant_root_command_v1(Some(&stored), key, replacement_digest, 62).is_err()
    );
}

#[test]
fn encrypted_active_record_round_trip_retains_exact_activation_receipt_bytes() {
    let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41);
    let activation =
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
    let record = record(CloudflareTenantRootDeriverRoleV1::DeriverA)
        .into_active(activation.clone(), 20)
        .expect("active record");
    let row = row_from_record(&cipher, &record);
    let opened = cipher.open(&row).expect("opened active record");
    let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = opened.lifecycle else {
        panic!("active lifecycle");
    };
    assert_eq!(
        active.activation.activation_receipt_bytes,
        activation.activation_receipt_bytes
    );
    assert_eq!(
        active.activation.activation_receipt_digest,
        activation.activation_receipt_digest
    );
    assert_eq!(
        active.activation.activated_at_ms,
        activation.activated_at_ms
    );

    let mut tampered = record;
    let CloudflareTenantRootRoleShareLifecycleV1::Active(active) = &mut tampered.lifecycle
    else {
        panic!("active lifecycle");
    };
    let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
        identity_digest, ..
    } = &mut active.activation.availability
    else {
        panic!("expected current-backup availability");
    };
    *identity_digest = TenantRootIdentityDigestV1::from_bytes([0x91; 32]);
    assert!(cipher.open(&row_from_record(&cipher, &tampered)).is_err());
}

#[test]
fn active_initial_activation_retry_reuses_exact_receipt_and_pending_command_revision() {
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let pending_stored = CloudflareStoredTenantRootRoleShareV1 {
        record: pending.clone(),
        revision: 1,
    };
    let activation =
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
    let active_record = pending
        .clone()
        .into_active(activation.clone(), 20)
        .expect("active record");
    let active_stored = CloudflareStoredTenantRootRoleShareV1 {
        record: active_record,
        revision: 2,
    };

    assert_eq!(
        active_stored
            .active_activation_receipt_bytes()
            .expect("stored activation receipt"),
        activation.activation_receipt_bytes()
    );
    let retry_pending = active_stored
        .initial_activation_retry_pending()
        .expect("retry pending record");
    assert_eq!(retry_pending.revision(), pending_stored.revision());
    assert!(matches!(
        retry_pending.record().lifecycle(),
        CloudflareTenantRootRoleShareLifecycleV1::Pending(_)
    ));
    assert_eq!(
        retry_pending.record().updated_at_ms(),
        pending_stored.record().updated_at_ms()
    );
    assert_eq!(
        activate_initial_payload_digest(&pending_stored, &activation, 20, 1)
            .expect("original activation payload"),
        activate_initial_payload_digest(&retry_pending, &activation, 20, 1)
            .expect("retry activation payload")
    );
}

#[test]
fn active_refresh_activation_retry_reconstructs_the_consumed_pending_revision() {
    let epoch = TenantRootShareEpoch::new(2).expect("epoch 2");
    let pending = record_for_identity_epoch(
        test_identity(),
        CloudflareTenantRootDeriverRoleV1::DeriverA,
        0x44,
        epoch,
        test_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA),
    );
    let activation = current_backup_activation_for_record(&pending, 0x88, 0x91, 30);
    let active = pending
        .clone()
        .into_active(activation, 30)
        .expect("active refresh successor");
    let retry_pending = CloudflareStoredTenantRootRoleShareV1 {
        record: active,
        revision: 2,
    }
    .refresh_activation_retry_pending()
    .expect("refresh retry pending");

    assert_eq!(retry_pending.revision(), 1);
    assert_eq!(retry_pending.record(), &pending);
}

#[test]
fn old_digest_only_activation_wire_is_rejected() {
    let activation =
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
    let old_shape = serde_json::json!({
        "availability": serde_json::to_value(&activation.availability)
            .expect("availability JSON"),
        "activation_receipt_digest_hex": encode_hex(
            activation.activation_receipt_digest().as_bytes()
        ),
        "activated_at_ms": activation.activated_at_ms(),
    });
    assert!(serde_json::from_value::<TenantRootRoleD1ActivationWireV1>(old_shape).is_err());
}

#[test]
fn activation_replay_substitution_retains_only_the_replacement_exact_bytes() {
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let original =
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
    let replacement =
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x90, 20);
    assert_ne!(
        original.activation_receipt_bytes(),
        replacement.activation_receipt_bytes()
    );
    let original_digest = original.activation_receipt_digest();
    let active = pending.into_active(original, 20).expect("active record");
    let mut stored = CloudflareStoredTenantRootRoleShareV1 {
        record: active,
        revision: 1,
    };
    {
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
            &mut stored.record.lifecycle
        else {
            panic!("active lifecycle");
        };
        active.activation.activation_receipt_bytes =
            replacement.activation_receipt_bytes.clone();
    }
    assert!(validate_active_stored_record_shape(&stored).is_err());
    {
        let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
            &mut stored.record.lifecycle
        else {
            panic!("active lifecycle");
        };
        active.activation.activation_receipt_digest = replacement.activation_receipt_digest;
        active.activation.activated_at_ms = replacement.activated_at_ms;
    }
    validate_active_stored_record_shape(&stored).expect("replacement remains self-consistent");
    let replacement_binding = active_binding_from_stored(&stored).expect("active binding");
    assert_eq!(
        replacement_binding.activation_receipt_digest(),
        replacement.activation_receipt_digest()
    );
    assert_ne!(
        replacement_binding.activation_receipt_digest(),
        original_digest
    );
}

#[test]
fn lifecycle_is_forward_only_and_retains_activation_evidence() {
    let pending = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let activation =
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
    let installation_digest = match pending.lifecycle() {
        CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) => {
            pending.installation_evidence_digest()
        }
        _ => unreachable!(),
    };
    let activation_digest = activation.activation_receipt_digest();
    let backup_digest = match &activation.availability {
        CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            role_backup_receipt_digest,
            ..
        } => *role_backup_receipt_digest,
        CloudflareTenantRootAvailabilityEvidenceV1::AcceptedPermanentDerivationLoss {
            ..
        } => {
            panic!("expected current-backup availability")
        }
        CloudflareTenantRootAvailabilityEvidenceV1::TenantHeldExternal { .. } => {
            panic!("expected current-backup availability")
        }
    };
    let active = pending
        .into_active(activation, 20)
        .expect("pending activates");
    assert_eq!(active.lifecycle.as_str(), "active");
    let CloudflareTenantRootRoleShareLifecycleV1::Active(active_evidence) = &active.lifecycle
    else {
        panic!("active lifecycle");
    };
    assert_eq!(
        active_evidence.pending.installation_evidence_digest,
        installation_digest
    );
    assert!(matches!(
        &active_evidence.activation.availability,
        CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
            role_backup_receipt_digest,
            ..
        } if *role_backup_receipt_digest == backup_digest
    ));
    assert_eq!(
        active_evidence.activation.activation_receipt_digest,
        activation_digest
    );
    let retired = active
        .into_retired(
            CloudflareTenantRootRetirementV1::new(
                lifecycle_receipt(0x90).expect("retirement receipt"),
                30,
            )
            .expect("retirement"),
            30,
        )
        .expect("active retires");
    assert_eq!(retired.lifecycle.as_str(), "retired");
    let CloudflareTenantRootRoleShareLifecycleV1::Retired(retired_evidence) =
        &retired.lifecycle
    else {
        panic!("retired lifecycle");
    };
    assert_eq!(
        retired_evidence.active.pending.installation_evidence_digest,
        installation_digest
    );
    assert_eq!(
        retired_evidence.active.activation.activation_receipt_digest,
        activation_digest
    );
    assert_eq!(
        retired_evidence.retirement.retirement_receipt_digest,
        lifecycle_receipt(0x90).expect("retirement receipt")
    );
    let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x43);
    let row = row_from_record(&cipher, &retired);
    assert_eq!(cipher.open(&row).expect("retired record opens"), retired);
    assert!(retired
        .clone()
        .into_active(
            current_backup_activation(
                CloudflareTenantRootDeriverRoleV1::DeriverA,
                0x99,
                0x9a,
                40
            ),
            40,
        )
        .is_err());
    assert!(TenantRootLifecycleReceiptDigestV1::from_bytes([0; 32]).is_err());
}

#[test]
fn lifecycle_rejects_out_of_order_evidence() {
    let mut activation =
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x89, 20);
    activation.activated_at_ms = 9;
    assert!(record(CloudflareTenantRootDeriverRoleV1::DeriverA)
        .into_active(activation, 10)
        .is_err());

    let active = record(CloudflareTenantRootDeriverRoleV1::DeriverA)
        .into_active(
            current_backup_activation(
                CloudflareTenantRootDeriverRoleV1::DeriverA,
                0x88,
                0x89,
                20,
            ),
            20,
        )
        .expect("active");
    assert!(active
        .into_retired(
            CloudflareTenantRootRetirementV1::new(
                lifecycle_receipt(0x90).expect("retirement receipt"),
                19,
            )
            .expect("retirement shape"),
            30,
        )
        .is_err());

    let active = record(CloudflareTenantRootDeriverRoleV1::DeriverA)
        .into_active(
            current_backup_activation(
                CloudflareTenantRootDeriverRoleV1::DeriverA,
                0x88,
                0x89,
                20,
            ),
            20,
        )
        .expect("active");
    assert!(active
        .into_retired(
            CloudflareTenantRootRetirementV1::new(
                lifecycle_receipt(0x90).expect("retirement receipt"),
                30,
            )
            .expect("retirement shape"),
            19,
        )
        .is_err());

    assert!(record(CloudflareTenantRootDeriverRoleV1::DeriverA)
        .into_active(
            current_backup_activation(
                CloudflareTenantRootDeriverRoleV1::DeriverA,
                0x88,
                0x89,
                20,
            ),
            19,
        )
        .is_err());
}
