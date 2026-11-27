//! Active-pair resolution and role-private cipher binding tests.

use super::*;

#[test]
fn active_pair_resolution_preserves_both_stored_role_commitments() {
    let custody_binding = test_custody_binding();
    let pair = cloudflare_require_active_tenant_root_pair_v1(
        &custody_binding,
        &deriver_a_share(0x44, epoch(1)),
        &deriver_b_share(0x44, epoch(1)),
    )
    .expect("one active root pair");

    assert_eq!(
        pair.identity_digest(),
        test_identity().digest().expect("identity digest")
    );
    assert_eq!(
        pair.custody_lineage(),
        TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage")
    );
    assert_eq!(pair.epoch(), epoch(1));
    assert_eq!(
        pair.deriver_a().share_commitment(),
        &pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17)
    );
    assert_eq!(
        pair.deriver_b().share_commitment(),
        &pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 29)
    );
    assert_eq!(pair.root_commitment(), pair.commitments().root_commitment());
    assert_eq!(
        pair.activation_receipt_digest(),
        custody_binding.activation_receipt_digest()
    );
}

#[test]
fn authoritative_pair_resolution_rejects_stale_pair_receipt_and_commitment() {
    let custody_binding = test_custody_binding();

    let stale_lineage = cloudflare_resolve_active_tenant_root_pair_v1(
        &custody_binding,
        &deriver_a_share(0x45, epoch(1)),
        &deriver_b_share(0x45, epoch(1)),
    )
    .expect("stale lineage is observed");
    assert_eq!(
        stale_lineage,
        TenantRootActivePairResolutionV1::Mismatched(
            router_ab_core::TenantRootActivePairMismatchV1::CustodyBinding
        )
    );

    let stale_epoch = cloudflare_resolve_active_tenant_root_pair_v1(
        &custody_binding,
        &deriver_a_share(0x44, epoch(2)),
        &deriver_b_share(0x44, epoch(2)),
    )
    .expect("stale epoch is observed");
    assert_eq!(
        stale_epoch,
        TenantRootActivePairResolutionV1::Mismatched(
            router_ab_core::TenantRootActivePairMismatchV1::CustodyBinding
        )
    );

    let TenantRootActiveRoleResolutionV1::Active(deriver_a) = deriver_a_share(0x44, epoch(1))
        .public_resolution()
        .expect("Deriver A public resolution")
    else {
        panic!("expected an active Deriver A resolution");
    };
    let mismatched_commitment = direct_active_role_resolution(
        TenantRootManagedRestoreRoleV1::DeriverB,
        0x44,
        epoch(1),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 34),
        deriver_a.activation_receipt_digest(),
    );
    let commitment_mismatch = resolve_authoritative_active_tenant_root_pair_binding_v1(
        custody_binding.identity_digest(),
        &custody_binding,
        &TenantRootActiveRoleResolutionV1::Active(deriver_a),
        &mismatched_commitment,
    )
    .expect("commitment mismatch is observed");
    assert_eq!(
        commitment_mismatch,
        TenantRootActivePairResolutionV1::Mismatched(
            router_ab_core::TenantRootActivePairMismatchV1::ShareCommitments
        )
    );

    let mut stale_receipt = match deriver_a_share(0x44, epoch(1)) {
        CloudflareTenantRootActiveRoleShareV1::Active(stored) => *stored,
        _ => panic!("expected active role share"),
    };
    let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
        &mut stale_receipt.record.lifecycle
    else {
        panic!("expected active lifecycle");
    };
    let replacement =
        current_backup_activation(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x88, 0x90, 20);
    active.activation.activation_receipt_bytes = replacement.activation_receipt_bytes.clone();
    active.activation.activation_receipt_digest = replacement.activation_receipt_digest;
    active.activation.activated_at_ms = replacement.activated_at_ms;
    let stale_receipt = CloudflareTenantRootActiveRoleShareV1::Active(Box::new(stale_receipt));
    let stale_receipt = cloudflare_resolve_active_tenant_root_pair_v1(
        &custody_binding,
        &stale_receipt,
        &deriver_b_share(0x44, epoch(1)),
    )
    .expect("stale receipt is observed");
    assert_eq!(
        stale_receipt,
        TenantRootActivePairResolutionV1::Mismatched(
            router_ab_core::TenantRootActivePairMismatchV1::ActivationReceiptDigest {
                expected: custody_binding.activation_receipt_digest(),
                deriver_a: replacement.activation_receipt_digest,
                deriver_b: deriver_b_share_activation_digest(),
            }
        )
    );
    assert!(commitment_mismatch.require_active().is_err());
}

#[test]
fn pair_resolution_never_moves_a_peers_sealed_share_across_the_role_boundary() {
    let deriver_a = deriver_a_share(0x44, epoch(7));
    let TenantRootActiveRoleResolutionV1::Active(binding) =
        deriver_a.public_resolution().expect("public resolution")
    else {
        panic!("expected an active public resolution");
    };
    // The public half carries coordinates and a commitment, and nothing sealed.
    assert_eq!(binding.role(), TenantRootManagedRestoreRoleV1::DeriverA);
    assert_eq!(binding.epoch(), epoch(7));
    assert_eq!(
        binding.share_commitment(),
        &pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17)
    );
}

#[test]
fn public_resolution_rejects_a_non_active_stored_record() {
    let pending = CloudflareTenantRootActiveRoleShareV1::Active(Box::new(
        CloudflareStoredTenantRootRoleShareV1 {
            record: record(CloudflareTenantRootDeriverRoleV1::DeriverA),
            revision: 1,
        },
    ));

    assert!(pending.public_resolution().is_err());
    assert!(pending.require_active().is_err());
}

#[test]
fn persisted_active_record_reconstructs_online_artifact_for_role_local_provider() {
    let role = CloudflareTenantRootDeriverRoleV1::DeriverA;
    let pending = record(role);
    let expected_identity_digest = pending.identity().digest().expect("identity digest");
    let expected_lineage = pending.custody_lineage();
    let expected_epoch = pending.epoch();
    let expected_commitment = pending.share_commitment().clone();
    let expected_key_ref = pending.epoch_wrapping_key_ref().to_owned();
    let expected_evidence_digest =
        record_installation_evidence_digest(&pending).expect("installation evidence digest");
    assert!(CloudflareStoredTenantRootRoleShareV1 {
        record: pending.clone(),
        revision: 1,
    }
    .into_online_role_share_artifact()
    .is_err());
    let share = SigningRootShare::from_canonical_bytes(
        TwoPartyDeriverRole::DeriverA.share_id(),
        Scalar::from(17_u64).to_bytes(),
    )
    .expect("Deriver A share");
    let activation = current_backup_activation_for_record(&pending, 0x88, 0x89, 20);
    let active = pending
        .into_active(activation, 20)
        .expect("active role share");
    let stored = CloudflareStoredTenantRootRoleShareV1 {
        record: active,
        revision: 1,
    };
    let artifact = stored
        .into_online_role_share_artifact()
        .expect("persisted online role-share artifact");
    let mut provider = PersistedOnlineShareProvider {
        opened_share: Some(SigningRootShareWire::from_share(&share)),
    };

    let opened = open_tenant_root_online_role_share_v1(artifact, &mut provider)
        .expect("provider-opened online role share");

    assert_eq!(opened.role(), TwoPartyDeriverRole::DeriverA);
    assert_eq!(opened.identity_digest(), expected_identity_digest);
    assert_eq!(opened.custody_lineage(), expected_lineage);
    assert_eq!(opened.epoch(), expected_epoch);
    assert_eq!(opened.share_commitment(), &expected_commitment);
    assert_eq!(opened.binding().epoch_wrapping_key_ref(), expected_key_ref);
    assert_eq!(
        opened.binding().installation_evidence_digest(),
        expected_evidence_digest
    );
}

#[test]
fn empty_active_load_is_publicly_unprovisioned_and_fails_closed() {
    let empty = CloudflareTenantRootActiveRoleShareV1::Unprovisioned;
    assert_eq!(
        empty.public_resolution().expect("empty public resolution"),
        TenantRootActiveRoleResolutionV1::Unprovisioned
    );
    assert!(empty.require_active().is_err());
}

#[test]
fn active_projection_rejects_invalid_commitments_and_activation_evidence() {
    let mut invalid_commitment = match deriver_a_share(0x44, epoch(7)) {
        CloudflareTenantRootActiveRoleShareV1::Active(stored) => *stored,
        _ => panic!("expected active role share"),
    };
    let mut identity_commitment = vec![0_u8; 34];
    identity_commitment[..2].copy_from_slice(&1_u16.to_be_bytes());
    identity_commitment[2..].copy_from_slice(RistrettoPoint::identity().compress().as_bytes());
    invalid_commitment.record.share_commitment =
        MpcPrfShareCommitmentWireV1::new(identity_commitment).expect("identity commitment");
    let invalid_commitment =
        CloudflareTenantRootActiveRoleShareV1::Active(Box::new(invalid_commitment));
    assert!(invalid_commitment.public_resolution().is_err());
    assert!(invalid_commitment.require_active().is_err());

    let mut tampered_evidence = match deriver_a_share(0x44, epoch(7)) {
        CloudflareTenantRootActiveRoleShareV1::Active(stored) => *stored,
        _ => panic!("expected active role share"),
    };
    let CloudflareTenantRootRoleShareLifecycleV1::Active(active) =
        &mut tampered_evidence.record.lifecycle
    else {
        panic!("expected active lifecycle");
    };
    let CloudflareTenantRootAvailabilityEvidenceV1::CurrentRoleBackup {
        identity_digest, ..
    } = &mut active.activation.availability
    else {
        panic!("expected current-backup availability");
    };
    *identity_digest = TenantRootIdentityDigestV1::from_bytes([0x91; 32]);
    let tampered_evidence =
        CloudflareTenantRootActiveRoleShareV1::Active(Box::new(tampered_evidence));
    assert!(tampered_evidence.public_resolution().is_err());
    assert!(tampered_evidence.require_active().is_err());
}

#[test]
fn pair_resolution_reports_exact_fail_closed_classifications() {
    let unprovisioned = CloudflareTenantRootActiveRoleShareV1::Unprovisioned;
    let ambiguous = CloudflareTenantRootActiveRoleShareV1::Ambiguous(
        TenantRootActiveRoleAmbiguityV1::DistinctLineages {
            custody_lineages: vec![
                TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage"),
                TenantRootCustodyLineageId::from_bytes([0x45; 16]).expect("lineage"),
            ],
        },
    );
    let cases = [
        (
            &unprovisioned,
            &unprovisioned,
            TenantRootActivePairResolutionV1::Unprovisioned,
        ),
        (
            &deriver_a_share(0x44, epoch(7)),
            &unprovisioned,
            TenantRootActivePairResolutionV1::Partial {
                present: TenantRootManagedRestoreRoleV1::DeriverA,
            },
        ),
        (
            &unprovisioned,
            &deriver_b_share(0x44, epoch(7)),
            TenantRootActivePairResolutionV1::Partial {
                present: TenantRootManagedRestoreRoleV1::DeriverB,
            },
        ),
        (
            &ambiguous,
            &deriver_b_share(0x44, epoch(7)),
            TenantRootActivePairResolutionV1::AmbiguousRole {
                role: TenantRootManagedRestoreRoleV1::DeriverA,
                ambiguity: match &ambiguous {
                    CloudflareTenantRootActiveRoleShareV1::Ambiguous(ambiguity) => {
                        ambiguity.clone()
                    }
                    _ => unreachable!(),
                },
            },
        ),
        (
            &deriver_a_share(0x44, epoch(7)),
            &ambiguous,
            TenantRootActivePairResolutionV1::AmbiguousRole {
                role: TenantRootManagedRestoreRoleV1::DeriverB,
                ambiguity: match &ambiguous {
                    CloudflareTenantRootActiveRoleShareV1::Ambiguous(ambiguity) => {
                        ambiguity.clone()
                    }
                    _ => unreachable!(),
                },
            },
        ),
        (
            &deriver_a_share(0x44, epoch(7)),
            &deriver_b_share(0x45, epoch(7)),
            TenantRootActivePairResolutionV1::Mismatched(
                router_ab_core::TenantRootActivePairMismatchV1::CustodyLineage {
                    deriver_a: TenantRootCustodyLineageId::from_bytes([0x44; 16])
                        .expect("lineage"),
                    deriver_b: TenantRootCustodyLineageId::from_bytes([0x45; 16])
                        .expect("lineage"),
                },
            ),
        ),
        (
            &deriver_a_share(0x44, epoch(7)),
            &deriver_b_share(0x44, epoch(9)),
            TenantRootActivePairResolutionV1::Mismatched(
                router_ab_core::TenantRootActivePairMismatchV1::Epoch {
                    deriver_a: epoch(7),
                    deriver_b: epoch(9),
                },
            ),
        ),
    ];

    for (deriver_a, deriver_b, expected) in cases {
        let actual = cloudflare_observe_active_tenant_root_pair_v1(
            &test_identity(),
            deriver_a,
            deriver_b,
        )
        .expect("reconciliation observes the public state");
        assert_eq!(actual, expected);
        assert!(cloudflare_require_active_tenant_root_pair_v1(
            &test_custody_binding(),
            deriver_a,
            deriver_b,
        )
        .is_err());
    }

    let TenantRootActiveRoleResolutionV1::Active(deriver_a) = deriver_a_share(0x44, epoch(7))
        .public_resolution()
        .expect("Deriver A public resolution")
    else {
        panic!("expected an active Deriver A resolution");
    };
    let mismatched_commitment = direct_active_role_resolution(
        TenantRootManagedRestoreRoleV1::DeriverB,
        0x44,
        epoch(7),
        pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 34),
        deriver_a.activation_receipt_digest(),
    );
    assert_eq!(
        resolve_active_tenant_root_pair_binding_v1(
            test_identity().digest().expect("identity digest"),
            &TenantRootActiveRoleResolutionV1::Active(deriver_a),
            &mismatched_commitment,
        )
        .expect("reconciliation observes invalid pair commitments"),
        TenantRootActivePairResolutionV1::Mismatched(
            router_ab_core::TenantRootActivePairMismatchV1::ShareCommitments,
        )
    );
}

#[test]
fn every_unsafe_pair_state_fails_closed_at_the_boundary() {
    let unprovisioned = CloudflareTenantRootActiveRoleShareV1::Unprovisioned;
    let ambiguous = CloudflareTenantRootActiveRoleShareV1::Ambiguous(
        TenantRootActiveRoleAmbiguityV1::DistinctLineages {
            custody_lineages: vec![
                TenantRootCustodyLineageId::from_bytes([0x44; 16]).expect("lineage"),
                TenantRootCustodyLineageId::from_bytes([0x45; 16]).expect("lineage"),
            ],
        },
    );
    // Unprovisioned, partial both ways, ambiguous either role, lineage, and
    // epoch mismatch: none of them yields a pair.
    for (deriver_a, deriver_b) in [
        (&unprovisioned, &unprovisioned),
        (&deriver_a_share(0x44, epoch(7)), &unprovisioned),
        (&unprovisioned, &deriver_b_share(0x44, epoch(7))),
        (&ambiguous, &deriver_b_share(0x44, epoch(7))),
        (&deriver_a_share(0x44, epoch(7)), &ambiguous),
        (
            &deriver_a_share(0x44, epoch(7)),
            &deriver_b_share(0x45, epoch(7)),
        ),
        (
            &deriver_a_share(0x44, epoch(7)),
            &deriver_b_share(0x44, epoch(9)),
        ),
    ] {
        assert!(
            cloudflare_require_active_tenant_root_pair_v1(
                &test_custody_binding(),
                deriver_a,
                deriver_b
            )
            .is_err(),
            "unsafe tenant-root pair state resolved to a usable pair"
        );
        // Reconciliation still observes the state without deriving from it.
        cloudflare_observe_active_tenant_root_pair_v1(&test_identity(), deriver_a, deriver_b)
            .expect("reconciliation observes the unsafe state");
    }
}

#[test]
fn a_role_share_in_the_wrong_pair_position_fails_closed() {
    assert!(cloudflare_observe_active_tenant_root_pair_v1(
        &test_identity(),
        &deriver_b_share(0x44, epoch(7)),
        &deriver_b_share(0x44, epoch(7)),
    )
    .is_err());
    assert!(cloudflare_observe_active_tenant_root_pair_v1(
        &test_identity(),
        &deriver_a_share(0x44, epoch(7)),
        &deriver_a_share(0x44, epoch(7)),
    )
    .is_err());
}

#[test]
fn a_role_share_for_a_foreign_identity_fails_closed() {
    let foreign_identity = TenantRootIdentityV1::new(
        "org-2",
        "project-1",
        "env-1",
        "project-1:env-1",
        "root-version-1",
    )
    .expect("foreign identity");
    assert!(cloudflare_observe_active_tenant_root_pair_v1(
        &test_identity(),
        &active_role_share_for_identity(
            foreign_identity.clone(),
            CloudflareTenantRootDeriverRoleV1::DeriverA,
            0x44,
            epoch(7),
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverA, 17),
        ),
        &deriver_b_share(0x44, epoch(7)),
    )
    .is_err());
    assert!(cloudflare_observe_active_tenant_root_pair_v1(
        &test_identity(),
        &deriver_a_share(0x44, epoch(7)),
        &active_role_share_for_identity(
            foreign_identity,
            CloudflareTenantRootDeriverRoleV1::DeriverB,
            0x44,
            epoch(7),
            pair_commitment(CloudflareTenantRootDeriverRoleV1::DeriverB, 29),
        ),
    )
    .is_err());
}

#[test]
fn role_private_d1_kek_matching_public_private_pair_is_accepted() {
    let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41);
    validate_role_private_d1_kek_key_pair(&cipher.public_key, &cipher.private_key)
        .expect("matching role-private D1 KEK pair is accepted");
}

#[test]
fn role_private_d1_kek_mismatched_public_private_pair_is_rejected() {
    let public_key = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41).public_key;
    let private_key =
        test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x42).private_key;
    assert!(validate_role_private_d1_kek_key_pair(&public_key, &private_key).is_err());
}

pub(super) fn row_from_record(
    cipher: &TenantRootRoleD1CipherV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
) -> TenantRootRoleD1RowV1 {
    let metadata = record_metadata(record).expect("metadata");
    TenantRootRoleD1RowV1 {
        tenant_identity_digest_hex: metadata.identity_digest_hex,
        custody_lineage_b64u: metadata.custody_lineage_b64u,
        tenant_root_share_epoch: epoch_i64_value(metadata.epoch).expect("epoch"),
        role: metadata.role.as_str().to_owned(),
        lifecycle: metadata.lifecycle,
        ciphertext_json: cipher.seal(record, 1).expect("ciphertext"),
        revision: 1,
        created_at_ms: timestamp_i64(record.created_at_ms).expect("created"),
        updated_at_ms: timestamp_i64(record.updated_at_ms).expect("updated"),
    }
}

pub(super) fn row_from_record_with_schema(
    cipher: &TenantRootRoleD1CipherV1,
    record: &CloudflareTenantRootRoleShareRecordV1,
    schema: &'static str,
) -> TenantRootRoleD1RowV1 {
    let metadata = record_metadata(record).expect("metadata");
    let revision = 1;
    let record_key = metadata.record_key();
    let aad = serde_json::to_vec(&TenantRootRoleD1AadV1 {
        environment: &cipher.environment,
        worker_role: cipher.role,
        tenant_identity_digest_hex: &metadata.identity_digest_hex,
        custody_lineage_b64u: &metadata.custody_lineage_b64u,
        tenant_root_share_epoch: metadata.epoch,
        record_role: metadata.role,
        lifecycle: &metadata.lifecycle,
        revision,
        purpose: TENANT_ROOT_ROLE_D1_PURPOSE,
        schema,
        record_key: &record_key,
    })
    .expect("old-schema AAD");
    let plaintext = serde_json::to_vec(record).expect("record JSON");
    let mut rng = CloudflareHpkeGetrandomRngV1;
    let (encapped_key, ciphertext) = CloudflareHpkeSuiteV1::seal_base(
        &mut rng,
        &cipher.public_key,
        TENANT_ROOT_ROLE_D1_HPKE_INFO,
        &aad,
        &plaintext,
    )
    .expect("old-schema ciphertext");
    let mut payload = Vec::with_capacity(encapped_key.as_ref().len() + ciphertext.len());
    payload.extend_from_slice(encapped_key.as_ref());
    payload.extend_from_slice(&ciphertext);
    let ciphertext_json = serde_json::to_string(&TenantRootRoleD1CiphertextV1 {
        key_version: cipher.key_version.clone(),
        tenant_identity_digest_hex: metadata.identity_digest_hex.clone(),
        custody_lineage_b64u: metadata.custody_lineage_b64u.clone(),
        tenant_root_share_epoch: metadata.epoch,
        role: metadata.role,
        lifecycle: metadata.lifecycle.clone(),
        ciphertext_b64u: encode_base64url_bytes_v1(&payload),
    })
    .expect("old-schema envelope");
    TenantRootRoleD1RowV1 {
        tenant_identity_digest_hex: metadata.identity_digest_hex,
        custody_lineage_b64u: metadata.custody_lineage_b64u,
        tenant_root_share_epoch: epoch_i64_value(metadata.epoch).expect("epoch"),
        role: metadata.role.as_str().to_owned(),
        lifecycle: metadata.lifecycle,
        ciphertext_json,
        revision,
        created_at_ms: timestamp_i64(record.created_at_ms).expect("created"),
        updated_at_ms: timestamp_i64(record.updated_at_ms).expect("updated"),
    }
}

#[test]
fn role_private_cipher_binds_tenant_lineage_epoch_role_and_lifecycle() {
    let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41);
    let record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let row = row_from_record(&cipher, &record);
    assert_eq!(cipher.open(&row).expect("record opens"), record);

    let mut wrong_revision = row_from_record(&cipher, &record);
    wrong_revision.revision = 2;
    assert!(cipher.open(&wrong_revision).is_err());

    let wrong_role = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverB, 0x41);
    assert!(wrong_role.open(&row).is_err());

    let wrong_key = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x42);
    assert!(wrong_key.open(&row).is_err());

    let mut wrong_epoch = row_from_record(&cipher, &record);
    wrong_epoch.tenant_root_share_epoch = 2;
    assert!(cipher.open(&wrong_epoch).is_err());

    let mut wrong_lifecycle = row_from_record(&cipher, &record);
    wrong_lifecycle.lifecycle = "active".to_owned();
    assert!(cipher.open(&wrong_lifecycle).is_err());
}

#[test]
fn old_schema_ciphertext_is_rejected_without_a_compatibility_parser() {
    let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41);
    let record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let old_row =
        row_from_record_with_schema(&cipher, &record, "tenant-root-role-private-d1/v1");
    assert!(cipher.open(&old_row).is_err());
}

#[test]
fn managed_restore_pending_provenance_survives_d1_wire_and_cannot_activate() {
    let mut record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let activation = current_backup_activation_for_record(&record, 0x88, 0x89, 40);
    let capability_digest = lifecycle_receipt(0x91).expect("capability digest");
    let backup_receipt_digest = lifecycle_receipt(0x92).expect("backup receipt digest");
    let installation_evidence_digest =
        record_installation_evidence_digest(&record).expect("installation evidence digest");
    let pending = CloudflareTenantRootPendingShareV1::from_managed_restore(
        installation_evidence_digest,
        capability_digest,
        backup_receipt_digest,
        30,
    )
    .expect("managed-restore pending state");
    record.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Pending(pending);
    record.updated_at_ms = 30;
    record.validate().expect("managed-restore pending record");

    let wire = serde_json::to_value(&record).expect("managed-restore record wire");
    let decoded = serde_json::from_value::<TenantRootRoleD1RecordWireV1>(wire)
        .expect("strict managed-restore record wire");
    let round_tripped = decoded.into_record().expect("round-tripped record");
    assert_eq!(round_tripped, record);
    let CloudflareTenantRootRoleShareLifecycleV1::Pending(pending) = round_tripped.lifecycle()
    else {
        panic!("managed-restore record must remain pending");
    };
    assert_eq!(
        pending.managed_restore_digests(),
        Some((capability_digest, backup_receipt_digest))
    );

    assert!(record.into_active(activation, 40).is_err());
}

#[test]
fn managed_restore_forward_refresh_source_requires_exact_provenance() {
    let mut managed_record = record(CloudflareTenantRootDeriverRoleV1::DeriverA);
    let identity_digest = managed_record.identity().digest().expect("identity digest");
    let custody_lineage = managed_record.custody_lineage();
    let epoch = managed_record.epoch();
    let capability_digest = lifecycle_receipt(0xa1).expect("capability digest");
    let backup_receipt_digest = lifecycle_receipt(0xa2).expect("backup receipt digest");
    let installation_receipt_digest =
        record_installation_evidence_digest(&managed_record).expect("installation digest");
    managed_record.lifecycle = CloudflareTenantRootRoleShareLifecycleV1::Pending(
        CloudflareTenantRootPendingShareV1::from_managed_restore(
            installation_receipt_digest,
            capability_digest,
            backup_receipt_digest,
            30,
        )
        .expect("managed-restore pending state"),
    );
    managed_record.updated_at_ms = 30;
    let stored = CloudflareStoredTenantRootRoleShareV1 {
        record: managed_record,
        revision: 1,
    };
    let cipher = test_cipher(CloudflareTenantRootDeriverRoleV1::DeriverA, 0x41);

    validate_managed_restore_forward_refresh_source(
        &cipher,
        &stored,
        identity_digest,
        custody_lineage,
        epoch,
        capability_digest,
        backup_receipt_digest,
        installation_receipt_digest,
    )
    .expect("exact managed-restore provenance");

    for (capability, backup, installation) in [
        (
            lifecycle_receipt(0xa3).expect("replacement capability digest"),
            backup_receipt_digest,
            installation_receipt_digest,
        ),
        (
            capability_digest,
            lifecycle_receipt(0xa4).expect("replacement backup digest"),
            installation_receipt_digest,
        ),
        (
            capability_digest,
            backup_receipt_digest,
            lifecycle_receipt(0xa5).expect("replacement installation digest"),
        ),
    ] {
        assert!(validate_managed_restore_forward_refresh_source(
            &cipher,
            &stored,
            identity_digest,
            custody_lineage,
            epoch,
            capability,
            backup,
            installation,
        )
        .is_err());
    }

    let ceremony = CloudflareStoredTenantRootRoleShareV1 {
        record: record(CloudflareTenantRootDeriverRoleV1::DeriverA),
        revision: 1,
    };
    assert!(validate_managed_restore_forward_refresh_source(
        &cipher,
        &ceremony,
        identity_digest,
        custody_lineage,
        epoch,
        capability_digest,
        backup_receipt_digest,
        installation_receipt_digest,
    )
    .is_err());
}
