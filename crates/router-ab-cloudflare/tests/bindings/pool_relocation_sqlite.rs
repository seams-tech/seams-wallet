use super::*;
use router_ab_cloudflare::{
    CloudflareSigningWorkerWalletScopeV1, SigningWorkerWalletEcdsaStoreV1,
    SigningWorkerWalletSqlV1, SigningWorkerWalletSqlValueV1,
};
use router_ab_core::RouterAbProtocolError;
use rusqlite::{Connection, TransactionBehavior};
use serde::de::DeserializeOwned;

// This odd integer cannot round-trip through a JavaScript number.
const HISTORICAL_SQL_VERSION: i64 = 9_007_199_254_740_993;

struct Sqlite<'a>(&'a Connection);

impl SigningWorkerWalletSqlV1 for Sqlite<'_> {
    fn query<T: DeserializeOwned>(
        &self,
        statement: &str,
        params: Vec<SigningWorkerWalletSqlValueV1>,
    ) -> router_ab_core::RouterAbProtocolResult<Vec<T>> {
        let mut query = self.0.prepare(statement).map_err(sql_error)?;
        let columns: Vec<String> = query
            .column_names()
            .iter()
            .map(|name| name.to_string())
            .collect();
        let values = params.into_iter().map(|value| match value {
            SigningWorkerWalletSqlValueV1::Null => rusqlite::types::Value::Null,
            SigningWorkerWalletSqlValueV1::Text(value) => rusqlite::types::Value::Text(value),
            SigningWorkerWalletSqlValueV1::Integer(value) => {
                rusqlite::types::Value::Text(value.to_string())
            }
        });
        let mut rows = query
            .query(rusqlite::params_from_iter(values))
            .map_err(sql_error)?;
        let mut result = Vec::new();
        while let Some(row) = rows.next().map_err(sql_error)? {
            let mut object = serde_json::Map::new();
            for (index, name) in columns.iter().enumerate() {
                let value = match row.get_ref(index).map_err(sql_error)? {
                    rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                    rusqlite::types::ValueRef::Integer(value) => value.into(),
                    rusqlite::types::ValueRef::Text(value) => {
                        std::str::from_utf8(value).map_err(sql_error)?.into()
                    }
                    _ => return Err(sql_error("Unexpected pool column type")),
                };
                object.insert(name.clone(), value);
            }
            result.push(serde_json::from_value(object.into()).map_err(sql_error)?);
        }
        Ok(result)
    }
}

fn sql_error(error: impl std::fmt::Display) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        error.to_string(),
    )
}

fn mutate(
    path: &std::path::Path,
    env: &CloudflareEnvMapV1,
    owner: &CloudflareSigningWorkerWalletScopeV1,
    command: CloudflareSigningWorkerEcdsaPoolCommandV1,
) -> router_ab_core::RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPoolMutationOutcomeV1> {
    let wire = serde_json::to_vec(&command).map_err(sql_error)?;
    let decoded = serde_json::from_slice(&wire).map_err(sql_error)?;
    with_store(path, env, |store| store.mutate_pool(owner.clone(), decoded))
}

fn with_store<T>(
    path: &std::path::Path,
    env: &CloudflareEnvMapV1,
    operation: impl FnOnce(
        &SigningWorkerWalletEcdsaStoreV1<'_, Sqlite<'_>>,
    ) -> router_ab_core::RouterAbProtocolResult<T>,
) -> router_ab_core::RouterAbProtocolResult<T> {
    let mut connection = Connection::open(path).map_err(sql_error)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    let sql = Sqlite(&transaction);
    let store = SigningWorkerWalletEcdsaStoreV1::open(&sql, env)?;
    store.ensure_schema()?;
    let result = operation(&store)?;
    transaction.commit().map_err(sql_error)?;
    Ok(result)
}

fn rows(path: &std::path::Path) -> Vec<(String, String, i64)> {
    let database = Connection::open(path).unwrap();
    let mut query = database
        .prepare(
            "SELECT pool_key, ciphertext_json, version FROM wallet_ecdsa_pool ORDER BY pool_key",
        )
        .unwrap();
    query
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn encrypted_pool_relocation_survives_reopen_and_preserves_history(
) -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::temp_dir().join(format!(
        "wallet-pool-relocation-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    std::fs::create_dir_all(&directory)?;
    let path = directory.join("pool.sqlite");
    let (private_key, public_key) = hpke_keypair(0x78);
    let env = CloudflareEnvMapV1::new(vec![
        (
            "SIGNING_WORKER_PRIVATE_D1_ENVIRONMENT",
            "relocation-e2e".to_owned(),
        ),
        (
            "SIGNING_WORKER_PRIVATE_D1_KEK_VERSION",
            "version-1".to_owned(),
        ),
        ("SIGNING_WORKER_PRIVATE_D1_KEK_PUBLIC_KEY", public_key),
        (
            "SIGNING_WORKER_PRIVATE_D1_KEK",
            encode_cloudflare_server_output_hpke_private_key_secret_v1(&private_key)?,
        ),
    ]);
    let base = router_ab_ecdsa_derivation_presignature_pool_record();
    let owner = CloudflareSigningWorkerWalletScopeV1::new(
        "org-1",
        "project-1",
        "dev",
        &base.scope.wallet_id,
    )?;
    let activation = router_ab_ecdsa_derivation_activation_request();
    let activation_material = router_ab_ecdsa_derivation_server_material_record(&activation);
    let activation_request = activation.to_recipient_proof_bundle_activation_request()?;
    with_store(&path, &env, |_| Ok(()))?;
    let interrupted_registration = with_store(&path, &env, |store| {
        store.activate(
            owner.clone(),
            activation_request.clone(),
            activation_material.clone(),
            1_000,
        )?;
        Err::<(), _>(sql_error("interrupted registration before commit"))
    });
    assert!(interrupted_registration.is_err());
    let authority_count: u64 = Connection::open(&path)?.query_row(
        "SELECT COUNT(*) FROM wallet_ecdsa_execution",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(
        authority_count, 0,
        "registration and execution authority roll back together"
    );
    reject_prepare_generation(&path, &env, &owner, 1, "execution authority is missing")?;
    with_store(&path, &env, |store| {
        store.activate(
            owner.clone(),
            activation_request.clone(),
            activation_material.clone(),
            1_000,
        )
    })?;
    let presign_request = router_ab_cloudflare::CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1 {
        scope: base.scope.clone(),
        authority: router_ab_cloudflare::CloudflareSigningWorkerEcdsaPresignAuthorityV1::OwnerWalletSession {
            wallet_scope: owner.clone(),
        },
        presign_session_id: format!("ecdsa-presign-v2:1500:{}", b64u(&[0x41; 32])),
        first_message_b64u: b64u(&[1]),
        ceremony_expires_at_ms: 1_500,
        material_expires_at_ms: 2_000,
    };
    with_store(&path, &env, |store| {
        store.claim_presign_authority(&presign_request, 1_000)
    })?;
    let replay = with_store(&path, &env, |store| {
        store.claim_presign_authority(&presign_request, 1_000)
    })
    .unwrap_err();
    assert_eq!(
        replay.code(),
        RouterAbProtocolErrorCode::ReplayedLocalRequest
    );
    let mut active_presign = presign_request.clone();
    active_presign.presign_session_id = format!("ecdsa-presign-v2:2000:{}", b64u(&[0x43; 32]));
    active_presign.ceremony_expires_at_ms = 2_000;
    let presign_step =
        router_ab_cloudflare::CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1 {
            scope: active_presign.scope.clone(),
            authority: active_presign.authority.clone(),
            presign_session_id: active_presign.presign_session_id.clone(),
            requested_stage:
                router_ab_cloudflare::CloudflareSigningWorkerEcdsaPresignRequestedStageV1::Triples,
            outgoing_messages_b64u: vec![b64u(&[1])],
            ceremony_expires_at_ms: active_presign.ceremony_expires_at_ms,
            material_expires_at_ms: active_presign.material_expires_at_ms,
        };
    assert!(with_store(&path, &env, |store| store
        .admit_presign_step(&presign_step, 1_000))
    .is_err());
    with_store(&path, &env, |store| {
        store.claim_presign_authority(&active_presign, 1_000)
    })?;
    with_store(&path, &env, |store| {
        store.admit_presign_step(&presign_step, 1_000)
    })?;
    let mut changed_step = presign_step.clone();
    changed_step.authority =
        router_ab_cloudflare::CloudflareSigningWorkerEcdsaPresignAuthorityV1::OperationStepUp {
            wallet_scope: owner.clone(),
        };
    assert!(with_store(&path, &env, |store| store
        .admit_presign_step(&changed_step, 1_000))
    .is_err());
    changed_step = presign_step.clone();
    changed_step.ceremony_expires_at_ms += 1;
    assert!(with_store(&path, &env, |store| store
        .admit_presign_step(&changed_step, 1_000))
    .is_err());
    let mut delayed_activation = activation_request.clone();
    delayed_activation.material_activation.activation_id = "late-ecdsa-activation".to_owned();
    delayed_activation.validate()?;
    let mut records = Vec::new();
    for id in ["available", "reserved", "consumed", "retired", "untouched"] {
        let mut material = base.clone();
        material.server_presignature_id = id.into();
        let inserted = mutate(
            &path,
            &env,
            &owner,
            CloudflareSigningWorkerEcdsaPoolCommandV1::PutAvailable { material },
        )?;
        let mut record = inserted.record().clone();
        if id == "reserved" || id == "consumed" {
            let reserved = mutate(
                &path,
                &env,
                &owner,
                CloudflareSigningWorkerEcdsaPoolCommandV1::Reserve {
                    scope: base.scope.clone(),
                    server_presignature_id: id.into(),
                    expected_revision: record.lifecycle.revision().value(),
                    request_digest: digest(0x44),
                    admitted_signing_digest: digest(0x55),
                    signing_worker_rerandomization_contribution32_b64u: b64u(&[0x33; 32]),
                    reserved_at_ms: 1_200,
                    request_expires_at_ms: 1_900,
                },
            )?;
            record = reserved.record().clone();
        }
        if id == "consumed" {
            let consumed = mutate(
                &path,
                &env,
                &owner,
                CloudflareSigningWorkerEcdsaPoolCommandV1::Consume {
                    scope: base.scope.clone(),
                    server_presignature_id: id.into(),
                    expected_revision: record.lifecycle.revision().value(),
                    request_digest: digest(0x44),
                    now_unix_ms: 1_300,
                },
            )?;
            record = consumed.record().clone();
        }
        if id == "retired" {
            let retired = mutate(
                &path,
                &env,
                &owner,
                CloudflareSigningWorkerEcdsaPoolCommandV1::Retire {
                    scope: base.scope.clone(),
                    server_presignature_id: id.into(),
                    expected_revision: record.lifecycle.revision().value(),
                    reason: TombstoneReason::ActivationEpochRetired,
                    now_unix_ms: 1_400,
                },
            )?;
            record = retired.record().clone();
        }
        records.push((id, record));
    }
    Connection::open(&path)?.execute(
        "UPDATE wallet_ecdsa_pool SET version = ? WHERE owner_json = ?",
        rusqlite::params![HISTORICAL_SQL_VERSION, serde_json::to_string(&owner)?],
    )?;
    let before = rows(&path);
    assert!(before.iter().any(|row| row.2 == HISTORICAL_SQL_VERSION));
    for (id, original) in records.iter().filter(|(id, _)| *id != "untouched") {
        let command = CloudflareSigningWorkerEcdsaPoolCommandV1::InvalidateForRelocation {
            scope: base.scope.clone(),
            server_presignature_id: id.to_string(),
            expected_revision: original.lifecycle.revision().value(),
            now_unix_ms: 1_500,
        };
        let invalidated = mutate(&path, &env, &owner, command.clone())?;
        if *id == "consumed" || *id == "retired" {
            assert_eq!(invalidated.record(), original);
        } else {
            let PoolRecord::Tombstone(terminal) = &invalidated.record().lifecycle else {
                panic!("material survived relocation")
            };
            assert_eq!(terminal.reason(), TombstoneReason::WalletRelocated);
            if let PoolRecord::Reserved(reserved) = &original.lifecycle {
                assert_eq!(
                    terminal.origin(),
                    router_ab_ecdsa_pool::TombstoneOrigin::Attempted(reserved.binding())
                );
            }
            let encoded = serde_json::to_string(invalidated.record())?;
            assert!(!encoded.contains("server_k_share32_b64u"));
            assert!(!encoded.contains("server_sigma_share32_b64u"));
        }
        let committed = rows(&path);
        assert_eq!(mutate(&path, &env, &owner, command)?, invalidated);
        assert_eq!(
            rows(&path),
            committed,
            "retry must preserve ciphertext and SQL version"
        );
        if *id != "consumed" && *id != "retired" {
            assert!(mutate(
                &path,
                &env,
                &owner,
                CloudflareSigningWorkerEcdsaPoolCommandV1::InvalidateForRelocation {
                    scope: base.scope.clone(),
                    server_presignature_id: id.to_string(),
                    expected_revision: original.lifecycle.revision().value(),
                    now_unix_ms: 1_501,
                }
            )
            .is_err());
            assert_eq!(rows(&path), committed);
            let mut material = base.clone();
            material.server_presignature_id = id.to_string();
            assert!(mutate(
                &path,
                &env,
                &owner,
                CloudflareSigningWorkerEcdsaPoolCommandV1::PutAvailable { material }
            )
            .is_err());
            assert_eq!(rows(&path), committed);
        }
    }
    let after = rows(&path);
    assert_eq!(
        before
            .iter()
            .zip(&after)
            .filter(|(left, right)| left == right)
            .count(),
        3,
        "consumed, retired, and unrelated rows must retain exact ciphertext and versions"
    );
    let other_owner = CloudflareSigningWorkerWalletScopeV1::new(
        "other-org",
        "project",
        "env",
        &base.scope.wallet_id,
    )?;
    let mut other_material = base.clone();
    other_material.server_presignature_id = "other-owner".into();
    let other_command = CloudflareSigningWorkerEcdsaPoolCommandV1::PutAvailable {
        material: other_material,
    };
    mutate(&path, &env, &other_owner, other_command.clone())?;
    let freeze_request = router_ab_cloudflare::SigningWorkerRelocationRequestV1 {
        move_id: format!("wmove_{}", "a".repeat(43)),
        source_generation: 1,
        invalidated_at_ms: 1_600,
    };
    let mut effect = admitted_router_ab_ecdsa_derivation_digest_finalize_request(
        router_ab_ecdsa_derivation_digest_signing_finalize_request(),
    );
    effect.wallet_scope = owner.clone();
    let mut missing_scope = serde_json::to_value(&effect)?;
    missing_scope
        .as_object_mut()
        .unwrap()
        .remove("wallet_scope");
    assert!(serde_json::from_value::<
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    >(missing_scope)
    .is_err());
    let mut missing_generation = serde_json::to_value(&effect)?;
    missing_generation
        .as_object_mut()
        .unwrap()
        .remove("ownership_generation");
    assert!(serde_json::from_value::<
        CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    >(missing_generation)
    .is_err());
    for generation in [0, 9_007_199_254_740_992] {
        let mut invalid = effect.clone();
        invalid.ownership_generation = generation;
        assert!(invalid.validate().is_err());
    }

    mutate(
        &path,
        &env,
        &owner,
        CloudflareSigningWorkerEcdsaPoolCommandV1::PutReserved {
            material: base.clone(),
            request_digest: effect.request.prepare_request_digest()?,
            admitted_signing_digest: digest(0x77),
            signing_worker_rerandomization_contribution32_b64u: b64u(&[0x33; 32]),
            reserved_at_ms: 1_200,
            request_expires_at_ms: 1_900,
        },
    )?;
    let claimed = with_store(&path, &env, |store| {
        store.claim_and_consume_effect(owner.clone(), effect.clone(), 1_300)
    })?;
    assert!(matches!(
        claimed,
        router_ab_cloudflare::CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Claimed { .. }
    ));
    let linked_freeze = router_ab_cloudflare::SigningWorkerLinkedPresignFreezeReceiptV1 {
        command: router_ab_cloudflare::SigningWorkerLinkedPresignRelocationRequestV1 {
            wallet_scope: owner.clone(),
            presign_session_id: "linked-session-relocation".to_owned(),
            server_presignature_id: "linked-presignature-relocation".to_owned(),
            request: freeze_request.clone(),
        },
        records_digest_hex: "ab".repeat(32),
        record_count: 1,
    };
    // The session service's registered identity and returned freeze receipt.
    // This scenario exercises the wallet store, not that remote service.
    Connection::open(&path)?.execute(
        "INSERT INTO wallet_linked_presign_sessions
         (presign_session_id, server_presignature_id, owner_json, request_digest_hex, ownership_generation)
         VALUES (?1, ?2, ?3, ?4, 1)",
        rusqlite::params![linked_freeze.command.presign_session_id, linked_freeze.command.server_presignature_id,
            serde_json::to_string(&owner)?, "cd".repeat(32)],
    )?;
    let draining = freeze(&path, &env, &owner, freeze_request.clone())?;
    assert_eq!(
        draining,
        router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1::Draining {
            pending_effects: 1,
            pending_linked_sessions: 1
        }
    );
    assert_eq!(
        freeze(&path, &env, &owner, freeze_request.clone())?,
        draining
    );
    let delayed_step = with_store(&path, &env, |store| {
        store.admit_presign_step(&presign_step, 1_700)
    })
    .unwrap_err();
    assert_eq!(
        delayed_step.code(),
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress
    );
    let admission = with_store(&path, &env, |store| {
        store.require_mutation_admission(&owner)
    })
    .unwrap_err();
    assert_eq!(
        admission.code(),
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress
    );
    let activation_error = with_store(&path, &env, |store| {
        store.activate(
            owner.clone(),
            delayed_activation.clone(),
            activation_material.clone(),
            1_000,
        )
    })
    .unwrap_err();
    assert_eq!(
        activation_error.code(),
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress
    );
    let response = RouterAbEcdsaDerivationEvmDigestSigningResponseV1::new_for_request(
        &effect.request,
        b64u(&[0x99; 65]),
    )?;
    with_store(&path, &env, |store| {
        store.commit_terminal(&owner, &effect, &response, 1_700)
    })?;
    assert_eq!(
        freeze(&path, &env, &owner, freeze_request.clone())?,
        router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1::Draining {
            pending_effects: 0,
            pending_linked_sessions: 1,
        },
    );
    let inventory = with_store(&path, &env, |store| {
        store.list_relocating_linked_presign_sessions(
            router_ab_cloudflare::SigningWorkerLinkedPresignInventoryRequestV1 {
                scope: owner.clone(),
                request: freeze_request.clone(),
                cursor: router_ab_cloudflare::SigningWorkerLinkedPresignCursorV1::Start,
                limit: 1,
            },
        )
    })?;
    let inventory = serde_json::to_value(inventory)?;
    assert_eq!(
        inventory["sessions"][0]["presign_session_id"],
        linked_freeze.command.presign_session_id
    );
    let interrupted = with_store(&path, &env, |store| {
        store.record_linked_presign_freeze(linked_freeze.clone())?;
        Err::<(), _>(sql_error("lost transaction before acknowledgement commit"))
    });
    assert!(interrupted.is_err());
    assert!(matches!(
        freeze(&path, &env, &owner, freeze_request.clone())?,
        router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1::Draining {
            pending_linked_sessions: 1,
            ..
        }
    ));
    with_store(&path, &env, |store| {
        store.record_linked_presign_freeze(linked_freeze.clone())
    })?;
    with_store(&path, &env, |store| {
        store.record_linked_presign_freeze(linked_freeze.clone())
    })?;
    let mut changed_linked_freeze = linked_freeze.clone();
    changed_linked_freeze.records_digest_hex = "ef".repeat(32);
    assert!(with_store(&path, &env, |store| store
        .record_linked_presign_freeze(changed_linked_freeze))
    .is_err());
    let frozen = freeze(&path, &env, &owner, freeze_request.clone())?;
    let router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1::Frozen { receipt } = &frozen
    else {
        panic!("settled pool must freeze");
    };
    assert_eq!(receipt.record_count, 11);
    assert_eq!(receipt.scope, owner);
    let activation_error = with_store(&path, &env, |store| {
        store.activate(
            owner.clone(),
            delayed_activation.clone(),
            activation_material.clone(),
            1_000,
        )
    })
    .unwrap_err();
    assert_eq!(
        activation_error.code(),
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress
    );
    let frozen_rows = rows(&path);
    assert!(with_store(&path, &env, |store| store
        .require_mutation_admission(&owner))
    .is_err());
    with_store(&path, &env, |store| {
        store.require_mutation_admission(&other_owner)
    })?;
    assert_eq!(freeze(&path, &env, &owner, freeze_request.clone())?, frozen);
    assert_eq!(rows(&path), frozen_rows);
    let mut delayed_material = base.clone();
    delayed_material.server_presignature_id = "late-unrecorded-refill".into();
    let rejected = mutate(
        &path,
        &env,
        &owner,
        CloudflareSigningWorkerEcdsaPoolCommandV1::PutAvailable {
            material: delayed_material,
        },
    )
    .unwrap_err();
    assert_eq!(
        rejected.code(),
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress
    );
    assert_eq!(rows(&path), frozen_rows);
    let mut changed = freeze_request;
    changed.source_generation = 2;
    assert!(freeze(&path, &env, &owner, changed).is_err());
    assert_eq!(rows(&path), frozen_rows);
    mutate(&path, &env, &other_owner, other_command)?;
    assert_eq!(
        rows(&path),
        frozen_rows,
        "another wallet retains its ordinary pool admission"
    );
    let mut later_presign = presign_request.clone();
    later_presign.presign_session_id = format!("ecdsa-presign-v2:2000:{}", b64u(&[0x42; 32]));
    later_presign.ceremony_expires_at_ms = 2_000;
    let frozen_claim = with_store(&path, &env, |store| {
        store.claim_presign_authority(&later_presign, 1_700)
    })
    .unwrap_err();
    assert_eq!(
        frozen_claim.code(),
        RouterAbProtocolErrorCode::LifecycleTransitionInProgress
    );
    later_presign.authority =
        router_ab_cloudflare::CloudflareSigningWorkerEcdsaPresignAuthorityV1::OwnerWalletSession {
            wallet_scope: other_owner.clone(),
        };
    with_store(&path, &env, |store| {
        store.claim_presign_authority(&later_presign, 1_700)
    })?;
    let exported_segments =
        verify_snapshot_export(&path, &env, receipt, &effect, &response, &presign_request)?;
    with_store(&path, &env, |store| {
        store.record_linked_presign_freeze(linked_freeze.clone())
    })?;
    let mut artifact = serde_json::json!({
        "scenario": "encrypted_pool_relocation", "records": 7,
        "available_and_reserved_destroyed": true, "reserved_binding_preserved": true,
        "consumed_retired_and_unrelated_bytes_preserved": true, "exact_retry_after_reopen": true,
        "changed_retry_rejected": true, "terminal_ids_cannot_be_repopulated": true,
        "pool_fence_survives_reopen": true,
        "pending_effect_blocks_freeze_until_commit": true,
        "admitted_effect_requires_wallet_scope": true,
        "presign_admission_closed_while_draining_and_frozen": true,
        "unrecorded_delayed_refill_rejected": true,
        "activation_writes_rejected_while_draining_and_frozen": true,
        "frozen_receipt_exact_retry": true,
        "snapshot_includes_pool_activation_and_terminal_effect": true,
        "snapshot_record_count": receipt.record_count,
        "exported_segments": exported_segments,
        "destination_preparation_exact_retry": true,
        "chunk_and_acknowledgement_rollback_together": true,
        "import_exact_retry_after_reopen": true,
        "populated_import_resumes_from_durable_cursor": true,
        "rolled_back_verification_preserves_cursor": true,
        "changed_import_and_out_of_order_segment_rejected": true,
        "staged_destination_remains_inactive": true,
        "incomplete_verification_and_wrong_key_rejected": true,
        "restore_rolls_back_before_commit": true,
        "verified_destination_remains_inactive": true,
        "exact_ciphertext_versions_and_terminal_result_restored": true,
        "sql_version_above_javascript_integer_precision_restored": HISTORICAL_SQL_VERSION.to_string(),
        "late_known_chunk_does_not_overwrite_restored_records": true,
        "export_exact_after_reopen": true,
        "export_rejects_changed_receipt_and_bounds": true,
        "export_preserves_sealed_bytes_after_live_inventory_change": true,
        "export_rejects_changed_sealed_page": true,
        "unaligned_and_maximum_chunks_preserve_exact_bytes": true,
        "other_wallet_pool_admission_preserved": true,
        "expired_presign_identity_history_restored": true,
        "presign_claims_fenced_and_other_wallet_claims_excluded": true,
        "presign_steps_require_pinned_authority_expiry_and_open_wallet": true,
        "scope": "Production wallet store and cipher on SQLite; excludes wallet-wide fencing and HTTP authorization"
    });
    artifact["linked_presign_settlement"] = serde_json::json!({
        "linked_session_freeze_acknowledgement_required": true,
        "linked_session_acknowledgement_rollback_and_exact_retry": true,
        "linked_session_acknowledgement_replays_after_cleanup": true,
        "return_move_excludes_imported_linked_session_history_from_draining": true,
    });
    artifact["activation"] = serde_json::json!({
        "activation_commit_opens_admission": true,
        "registration_and_authority_rollback_together": true,
        "missing_authority_cannot_execute_as_generation_one": true,
        "inactive_destination_has_no_execution_authority": true,
        "fresh_presign_authority_admitted_after_activation": true,
        "activation_rollback_preserves_closed_admission": true,
        "activation_retry_never_reopens_later_source_fence": true,
        "source_freeze_requires_activated_generation": true,
    });
    artifact["cleanup"] = serde_json::json!({
        "bounded_batches_resume_after_reopen": true,
        "rollback_preserves_frozen_snapshot": true,
        "source_stays_closed_and_destination_stays_open": true,
        "unrelated_wallet_rows_preserved": true,
        "completion_and_freeze_receipts_replay": true,
    });
    artifact["return_move"] = serde_json::json!({
        "fresh_store_accepts_generation_three": true,
        "exact_ciphertext_and_terminal_result_preserved": true,
        "old_generations_remain_closed_after_cleanup": true,
        "stale_prepare_rejected_at_destination_and_return": true,
        "each_cleanup_deletes_at_most_sixteen_import_chunks": true,
    });
    std::fs::write(
        directory.join("receipt.json"),
        serde_json::to_vec_pretty(&artifact)?,
    )?;
    println!("POOL_RELOCATION_STORAGE_E2E {}", artifact);
    println!(
        "POOL_RELOCATION_STORAGE_RECEIPT {}",
        directory.join("receipt.json").display()
    );
    std::fs::remove_file(path)?;
    Ok(())
}

fn freeze(
    path: &std::path::Path,
    env: &CloudflareEnvMapV1,
    owner: &CloudflareSigningWorkerWalletScopeV1,
    request: router_ab_cloudflare::SigningWorkerRelocationRequestV1,
) -> router_ab_core::RouterAbProtocolResult<router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1>
{
    with_store(path, env, |store| {
        store.freeze_pool_for_relocation(owner.clone(), request)
    })
}

fn verify_snapshot_export(
    path: &std::path::Path,
    env: &CloudflareEnvMapV1,
    receipt: &router_ab_cloudflare::SigningWorkerPoolFreezeReceiptV1,
    effect: &CloudflareSigningWorkerAdmittedRouterAbEcdsaDerivationEvmDigestFinalizeRequestV1,
    response: &RouterAbEcdsaDerivationEvmDigestSigningResponseV1,
    presign_request: &router_ab_cloudflare::CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
) -> Result<u32, Box<dyn std::error::Error>> {
    let mut request = router_ab_cloudflare::SigningWorkerEcdsaExportRequestV1 {
        receipt: receipt.clone(),
        segment_index: 0,
        chunk_bytes: 1_024,
    };
    let first = with_store(path, env, |store| {
        store.export_ecdsa_snapshot(request.clone())
    })?;
    assert!(first.segment_count > 1);
    let destination = path.with_file_name("destination.sqlite");
    let preparation = router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Prepare {
        scope: receipt.scope.clone(),
        request: receipt.request.clone(),
        chunk_bytes: 1_024,
    };
    let prepared = with_store(&destination, env, |store| {
        store.transfer_ecdsa_snapshot(preparation.clone())
    })?;
    assert_eq!(
        with_store(&destination, env, |store| {
            store.transfer_ecdsa_snapshot(preparation.clone())
        })?,
        prepared
    );
    assert!(with_store(path, env, |store| {
        store.transfer_ecdsa_snapshot(preparation.clone())
    })
    .is_err());
    assert!(with_store(&destination, env, |store| {
        store.require_mutation_admission(&receipt.scope)
    })
    .is_err());
    let mut out_of_order = first.clone();
    out_of_order.segment_index = 1;
    assert!(with_store(&destination, env, |store| {
        store.transfer_ecdsa_snapshot(
            router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Import {
                chunk: out_of_order,
            },
        )
    })
    .is_err());
    let rolled_back = with_store(&destination, env, |store| {
        store.transfer_ecdsa_snapshot(
            router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Import {
                chunk: first.clone(),
            },
        )?;
        Err::<(), _>(sql_error(
            "simulated interruption before transaction commit",
        ))
    });
    assert!(rolled_back.is_err());
    let stored_chunks: u64 = Connection::open(&destination)?.query_row(
        "SELECT COUNT(*) FROM wallet_ecdsa_import_chunks",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(stored_chunks, 0);

    let activate = router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Activate {
        receipt: receipt.clone(),
    };
    assert!(with_store(&destination, env, |store| store
        .transfer_ecdsa_snapshot(activate.clone()))
    .is_err());
    let verify = router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Verify {
        receipt: receipt.clone(),
    };
    assert!(with_store(&destination, env, |store| store
        .transfer_ecdsa_snapshot(verify.clone()))
    .is_err());
    let status = router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Status {
        receipt: receipt.clone(),
        chunk_bytes: 1_024,
    };
    // Every iteration opens a new connection and resumes from committed progress.
    let mut bytes = Vec::new();
    loop {
        let progress = with_store(&destination, env, |store| {
            store.transfer_ecdsa_snapshot(status.clone())
        })?;
        let segment_index = match progress {
            router_ab_cloudflare::SigningWorkerEcdsaTransferResponseV1::Prepared { .. } => 0,
            router_ab_cloudflare::SigningWorkerEcdsaTransferResponseV1::Receiving {
                receipt: stored,
                chunk_bytes,
                segment_count,
                next_segment,
            } => {
                assert_eq!(stored, *receipt);
                assert_eq!(chunk_bytes, 1_024);
                assert_eq!(segment_count, first.segment_count);
                assert!(next_segment <= segment_count);
                if next_segment == segment_count {
                    break;
                }
                next_segment
            }
            unexpected => panic!("Unexpected import progress: {unexpected:?}"),
        };
        assert_eq!(
            segment_index as usize * 1_024,
            bytes.len(),
            "durable progress must neither skip nor repeat a segment"
        );
        request.segment_index = segment_index;
        let chunk = with_store(path, env, |store| {
            store.export_ecdsa_snapshot(request.clone())
        })?;
        let retried = with_store(path, env, |store| {
            store.export_ecdsa_snapshot(request.clone())
        })?;
        assert_eq!(chunk, retried);
        let import = router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Import {
            chunk: chunk.clone(),
        };
        let acknowledged = with_store(&destination, env, |store| {
            store.transfer_ecdsa_snapshot(import.clone())
        })?;
        assert_eq!(
            with_store(&destination, env, |store| store
                .transfer_ecdsa_snapshot(import.clone()))?,
            acknowledged
        );
        let data = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&chunk.data_b64u)?;
        let mut changed = chunk;
        let mut changed_data = data.clone();
        changed_data[0] ^= 1;
        changed.data_b64u = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(changed_data);
        let conflict = with_store(&destination, env, |store| {
            store.transfer_ecdsa_snapshot(
                router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Import {
                    chunk: changed,
                },
            )
        })
        .unwrap_err();
        assert_eq!(
            conflict.code(),
            RouterAbProtocolErrorCode::ReplayedLocalRequest
        );
        assert!(!data.is_empty() && data.len() <= 1_024);
        bytes.extend(data);
    }
    for chunk_bytes in [4_093, 65_536] {
        let segment_count = bytes.len().div_ceil(chunk_bytes as usize);
        for segment_index in 0..segment_count {
            let chunk = with_store(path, env, |store| {
                store.export_ecdsa_snapshot(router_ab_cloudflare::SigningWorkerEcdsaExportRequestV1 {
                    receipt: receipt.clone(),
                    segment_index: segment_index as u32,
                    chunk_bytes,
                })
            })?;
            let actual = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(chunk.data_b64u)?;
            let start = segment_index * chunk_bytes as usize;
            let end = (start + chunk_bytes as usize).min(bytes.len());
            assert_eq!(actual, bytes[start..end], "Chunk boundaries must not change sealed bytes");
        }
    }
    let (scope, move_request, snapshot): (
        CloudflareSigningWorkerWalletScopeV1,
        router_ab_cloudflare::SigningWorkerRelocationRequestV1,
        serde_json::Value,
    ) = serde_json::from_slice(&bytes)?;
    assert_eq!(scope, receipt.scope);
    assert_eq!(move_request, receipt.request);
    assert_eq!(snapshot["pools"].as_array().unwrap().len(), 6);
    assert_eq!(snapshot["activations"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["effects"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["presign_authorities"].as_array().unwrap().len(), 2);
    assert!(snapshot["effects"][0]["terminal_json"].as_str().is_some());
    request.segment_index = first.segment_count;
    assert!(with_store(path, env, |store| store
        .export_ecdsa_snapshot(request.clone()))
    .is_err());
    request.segment_index = 0;
    request.chunk_bytes = 65_537;
    assert!(with_store(path, env, |store| store
        .export_ecdsa_snapshot(request.clone()))
    .is_err());
    request.chunk_bytes = 1_024;
    request.receipt.record_count += 1;
    assert!(with_store(path, env, |store| store
        .export_ecdsa_snapshot(request.clone()))
    .is_err());
    request.receipt = receipt.clone();
    request.receipt.scope.wallet_id = "another-wallet".to_owned();
    assert!(with_store(path, env, |store| store
        .export_ecdsa_snapshot(request.clone()))
    .is_err());
    request.receipt = receipt.clone();
    let database = Connection::open(path)?;
    let owner_json = serde_json::to_string(&receipt.scope)?;
    database.execute(
        "UPDATE wallet_ecdsa_pool SET version = version + 1 WHERE owner_json = ?",
        [&owner_json],
    )?;
    assert_eq!(
        with_store(path, env, |store| store.export_ecdsa_snapshot(request.clone()))?,
        first,
        "Export must read the sealed bytes rather than reconstruct live rows",
    );
    database.execute(
        "UPDATE wallet_ecdsa_pool SET version = version - 1 WHERE owner_json = ?",
        [&owner_json],
    )?;
    assert_eq!(
        with_store(path, env, |store| store
            .export_ecdsa_snapshot(request.clone()))?,
        first,
    );
    let page_digest: String = database.query_row(
        "SELECT digest_hex FROM wallet_ecdsa_snapshot_pages WHERE owner_json = ? AND move_id = ? AND page_index = 0",
        rusqlite::params![owner_json, receipt.request.move_id],
        |row| row.get(0),
    )?;
    database.execute(
        "UPDATE wallet_ecdsa_snapshot_pages SET digest_hex = ? WHERE owner_json = ? AND move_id = ? AND page_index = 0",
        rusqlite::params!["0".repeat(64), owner_json, receipt.request.move_id],
    )?;
    assert!(with_store(path, env, |store| store.export_ecdsa_snapshot(request.clone())).is_err());
    database.execute(
        "UPDATE wallet_ecdsa_snapshot_pages SET digest_hex = ? WHERE owner_json = ? AND move_id = ? AND page_index = 0",
        rusqlite::params![page_digest, owner_json, receipt.request.move_id],
    )?;
    assert_eq!(with_store(path, env, |store| store.export_ecdsa_snapshot(request.clone()))?, first);
    assert!(with_store(&destination, env, |store| {
        store.require_mutation_admission(&receipt.scope)
    })
    .is_err());
    assert!(
        rows(&destination).is_empty(),
        "staged chunks do not activate records"
    );
    assert_eq!(
        with_store(&destination, env, |store| {
            store.transfer_ecdsa_snapshot(preparation.clone())
        })?,
        prepared
    );
    let (wrong_private, wrong_public) = hpke_keypair(0x79);
    let wrong_env = env.clone().with_overrides(vec![
        ("SIGNING_WORKER_PRIVATE_D1_KEK_PUBLIC_KEY", wrong_public),
        (
            "SIGNING_WORKER_PRIVATE_D1_KEK",
            encode_cloudflare_server_output_hpke_private_key_secret_v1(&wrong_private)?,
        ),
    ]);
    assert!(with_store(&destination, &wrong_env, |store| store
        .transfer_ecdsa_snapshot(verify.clone()))
    .is_err());
    assert!(rows(&destination).is_empty());
    let interrupted = with_store(&destination, env, |store| {
        store.transfer_ecdsa_snapshot(verify.clone())?;
        Err::<(), _>(sql_error(
            "simulated interruption after restore before commit",
        ))
    });
    assert!(interrupted.is_err());
    assert!(rows(&destination).is_empty());
    assert_eq!(
        with_store(&destination, env, |store| store
            .transfer_ecdsa_snapshot(status.clone()))?,
        router_ab_cloudflare::SigningWorkerEcdsaTransferResponseV1::Receiving {
            receipt: receipt.clone(),
            chunk_bytes: 1_024,
            segment_count: first.segment_count,
            next_segment: first.segment_count,
        },
        "a rolled-back verification retains the completed import cursor"
    );
    let verified = with_store(&destination, env, |store| {
        store.transfer_ecdsa_snapshot(verify.clone())
    })?;
    assert_eq!(
        with_store(&destination, env, |store| store
            .transfer_ecdsa_snapshot(verify.clone()))?,
        verified
    );
    assert_eq!(
        with_store(&destination, env, |store| store
            .transfer_ecdsa_snapshot(status.clone()))?,
        verified,
        "a restarted transfer loop observes durable verification"
    );
    let expected_rows: Vec<(String, String, i64)> = snapshot["pools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["pool_key"].as_str().unwrap().to_owned(),
                row["ciphertext_json"].as_str().unwrap().to_owned(),
                row["version"].as_str().unwrap().parse::<i64>().unwrap(),
            )
        })
        .collect();
    assert_eq!(rows(&destination), expected_rows);
    assert_eq!(
        with_store(&destination, env, |store| {
            store.load_presign_authority(&receipt.scope, &presign_request.presign_session_id, 1_000)
        })?,
        presign_request.authority
    );
    let expired = with_store(&destination, env, |store| {
        store.load_presign_authority(&receipt.scope, &presign_request.presign_session_id, 1_700)
    })
    .unwrap_err();
    assert_eq!(
        expired.code(),
        RouterAbProtocolErrorCode::ExpiredLocalRequest
    );
    assert!(expected_rows
        .iter()
        .any(|row| row.2 == HISTORICAL_SQL_VERSION));
    assert!(expected_rows
        .iter()
        .any(|row| row.2 == HISTORICAL_SQL_VERSION + 1));
    assert!(with_store(&destination, env, |store| store
        .require_mutation_admission(&receipt.scope))
    .is_err());
    let replay = with_store(&destination, env, |store| {
        store.claim_and_consume_effect(receipt.scope.clone(), effect.clone(), 2_000)
    })?;
    let router_ab_cloudflare::CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Replay {
        terminal_json,
    } = replay
    else {
        panic!("restored operation must replay its original result");
    };
    assert_eq!(terminal_json, serde_json::to_string(response)?);
    let late = router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Import {
        chunk: first.clone(),
    };
    assert!(with_store(&destination, env, |store| store
        .transfer_ecdsa_snapshot(late.clone()))
    .is_ok());
    assert_eq!(rows(&destination), expected_rows);
    reject_prepare_generation(
        &destination,
        env,
        &receipt.scope,
        2,
        "execution authority is missing",
    )?;
    let interrupted_activation = with_store(&destination, env, |store| {
        store.transfer_ecdsa_snapshot(activate.clone())?;
        Err::<(), _>(sql_error("interrupted activation before commit"))
    });
    assert!(interrupted_activation.is_err());
    assert!(with_store(&destination, env, |store| store
        .require_mutation_admission(&receipt.scope))
    .is_err());
    let activated = with_store(&destination, env, |store| {
        store.transfer_ecdsa_snapshot(activate.clone())
    })?;
    assert_eq!(
        activated,
        router_ab_cloudflare::SigningWorkerEcdsaTransferResponseV1::Activated {
            receipt: receipt.clone()
        }
    );
    with_store(&destination, env, |store| {
        store.require_mutation_admission(&receipt.scope)
    })?;
    assert_eq!(
        with_store(&destination, env, |store| store
            .transfer_ecdsa_snapshot(activate.clone()))?,
        activated
    );
    assert_eq!(
        with_store(&destination, env, |store| store
            .transfer_ecdsa_snapshot(status.clone()))?,
        activated
    );
    assert_eq!(rows(&destination), expected_rows);
    reject_prepare_generation(
        &destination,
        env,
        &receipt.scope,
        1,
        "ownership generation differs",
    )?;
    let mut fresh_presign = presign_request.clone();
    fresh_presign.presign_session_id = format!("ecdsa-presign-v2:2000:{}", b64u(&[0x44; 32]));
    fresh_presign.ceremony_expires_at_ms = 2_000;
    with_store(&destination, env, |store| {
        store.claim_presign_authority(&fresh_presign, 1_700)
    })?;
    assert!(freeze(&destination, env, &receipt.scope, receipt.request.clone()).is_err());
    let router_ab_cloudflare::SigningWorkerEcdsaTransferResponseV1::Activated {
        receipt: activation_receipt,
    } = activated.clone()
    else {
        return Err("destination activation receipt is required".into());
    };
    let cleanup = router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Cleanup {
        activation: activation_receipt,
    };
    let unrelated_rows: Vec<_> = rows(path)
        .into_iter()
        .filter(|row| !expected_rows.iter().any(|moved| moved.0 == row.0))
        .collect();
    assert!(!unrelated_rows.is_empty());
    let interrupted_cleanup = with_store(path, env, |store| {
        store.transfer_ecdsa_snapshot(cleanup.clone())?;
        Err::<(), _>(sql_error("interrupted cleanup before commit"))
    });
    assert!(interrupted_cleanup.is_err());
    request.segment_index = 0;
    assert_eq!(
        with_store(path, env, |store| store
            .export_ecdsa_snapshot(request.clone()))?,
        first
    );
    let mut cleanup_calls = 0;
    let cleaned = loop {
        cleanup_calls += 1;
        assert!(cleanup_calls < 64, "cleanup must make bounded progress");
        let progress = with_store(path, env, |store| {
            store.transfer_ecdsa_snapshot(cleanup.clone())
        })?;
        match progress {
            router_ab_cloudflare::SigningWorkerEcdsaTransferResponseV1::Cleaning {
                receipt: stored,
            } => assert_eq!(stored, *receipt),
            router_ab_cloudflare::SigningWorkerEcdsaTransferResponseV1::Cleaned { .. } => {
                break progress
            }
            unexpected => panic!("Unexpected cleanup result: {unexpected:?}"),
        }
        assert!(with_store(path, env, |store| store
            .require_mutation_admission(&receipt.scope))
        .is_err());
        with_store(&destination, env, |store| {
            store.require_mutation_admission(&receipt.scope)
        })?;
    };
    assert!(cleanup_calls > 1);
    assert_eq!(
        with_store(path, env, |store| store
            .transfer_ecdsa_snapshot(cleanup.clone()))?,
        cleaned
    );
    assert_eq!(rows(path), unrelated_rows);
    assert_eq!(rows(&destination), expected_rows);
    assert!(with_store(path, env, |store| store
        .require_mutation_admission(&receipt.scope))
    .is_err());
    assert!(with_store(path, env, |store| store
        .export_ecdsa_snapshot(request.clone()))
    .is_err());
    assert_eq!(
        freeze(path, env, &receipt.scope, receipt.request.clone())?,
        router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1::Frozen {
            receipt: receipt.clone()
        }
    );
    let next_move = router_ab_cloudflare::SigningWorkerRelocationRequestV1 {
        move_id: format!("wmove_{}", "r".repeat(43)),
        source_generation: receipt.request.source_generation + 1,
        invalidated_at_ms: receipt.request.invalidated_at_ms + 1,
    };
    let frozen_again = freeze(&destination, env, &receipt.scope, next_move.clone())?;
    assert!(matches!(
        frozen_again,
        router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1::Frozen { .. }
    ));
    assert_eq!(
        with_store(&destination, env, |store| store
            .transfer_ecdsa_snapshot(activate.clone()))?,
        activated
    );
    assert!(with_store(&destination, env, |store| store
        .require_mutation_admission(&receipt.scope))
    .is_err());
    assert_eq!(
        freeze(&destination, env, &receipt.scope, next_move)?,
        frozen_again
    );
    let router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1::Frozen {
        receipt: return_receipt,
    } = frozen_again
    else {
        return Err("return source must be frozen".into());
    };
    let returned = path.with_file_name("returned.sqlite");
    restore_returned_wallet(&destination, &returned, env, &return_receipt)?;
    assert_eq!(rows(&returned), expected_rows);
    with_store(&returned, env, |store| {
        store.require_mutation_admission(&receipt.scope)
    })?;
    assert!(with_store(path, env, |store| store
        .require_mutation_admission(&receipt.scope))
    .is_err());
    let return_cleanup = router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1::Cleanup {
        activation: return_receipt.clone(),
    };
    let mut deletion_calls = 0;
    loop {
        let before: u64 = Connection::open(&destination)?.query_row(
            "SELECT COUNT(*) FROM wallet_ecdsa_import_chunks",
            [],
            |row| row.get(0),
        )?;
        let result = with_store(&destination, env, |store| {
            store.transfer_ecdsa_snapshot(return_cleanup.clone())
        })?;
        let after: u64 = Connection::open(&destination)?.query_row(
            "SELECT COUNT(*) FROM wallet_ecdsa_import_chunks",
            [],
            |row| row.get(0),
        )?;
        assert!(before >= after && before - after <= 16);
        deletion_calls += 1;
        assert!(deletion_calls < 64);
        if matches!(
            result,
            router_ab_cloudflare::SigningWorkerEcdsaTransferResponseV1::Cleaned { .. }
        ) {
            break;
        }
    }
    assert!(
        deletion_calls > 3,
        "cleanup must span stored import chunks and wallet records"
    );
    assert_eq!(
        with_store(&destination, env, |store| store
            .transfer_ecdsa_snapshot(activate.clone()))?,
        activated
    );
    assert!(with_store(&destination, env, |store| store
        .require_mutation_admission(&receipt.scope))
    .is_err());
    with_store(&returned, env, |store| {
        store.require_mutation_admission(&receipt.scope)
    })?;
    reject_prepare_generation(
        &returned,
        env,
        &receipt.scope,
        1,
        "ownership generation differs",
    )?;
    reject_prepare_generation(
        &returned,
        env,
        &receipt.scope,
        2,
        "ownership generation differs",
    )?;
    let replay = with_store(&returned, env, |store| {
        store.claim_and_consume_effect(receipt.scope.clone(), effect.clone(), 2_000)
    })?;
    let router_ab_cloudflare::CloudflareSigningWorkerEcdsaClaimAndConsumeV1::Replay {
        terminal_json,
    } = replay
    else {
        return Err("returned wallet must replay the original terminal result".into());
    };
    assert_eq!(terminal_json, serde_json::to_string(response)?);
    std::fs::remove_file(returned)?;
    std::fs::remove_file(destination)?;
    Ok(first.segment_count)
}

fn restore_returned_wallet(
    source: &std::path::Path,
    destination: &std::path::Path,
    env: &CloudflareEnvMapV1,
    receipt: &router_ab_cloudflare::SigningWorkerPoolFreezeReceiptV1,
) -> Result<(), Box<dyn std::error::Error>> {
    use router_ab_cloudflare::{
        SigningWorkerEcdsaTransferRequestV1 as Command,
        SigningWorkerEcdsaTransferResponseV1 as Response,
    };
    with_store(destination, env, |store| {
        store.transfer_ecdsa_snapshot(Command::Prepare {
            scope: receipt.scope.clone(),
            request: receipt.request.clone(),
            chunk_bytes: 1_024,
        })
    })?;
    loop {
        let progress = with_store(destination, env, |store| {
            store.transfer_ecdsa_snapshot(Command::Status {
                receipt: receipt.clone(),
                chunk_bytes: 1_024,
            })
        })?;
        let segment_index = match progress {
            Response::Prepared { .. } => 0,
            Response::Receiving {
                next_segment,
                segment_count,
                ..
            } if next_segment < segment_count => next_segment,
            Response::Receiving {
                next_segment,
                segment_count,
                ..
            } if next_segment == segment_count => break,
            unexpected => return Err(format!("Unexpected return progress: {unexpected:?}").into()),
        };
        let chunk = with_store(source, env, |store| {
            store.export_ecdsa_snapshot(router_ab_cloudflare::SigningWorkerEcdsaExportRequestV1 {
                receipt: receipt.clone(),
                segment_index,
                chunk_bytes: 1_024,
            })
        })?;
        with_store(destination, env, |store| {
            store.transfer_ecdsa_snapshot(Command::Import { chunk })
        })?;
    }
    with_store(destination, env, |store| {
        store.transfer_ecdsa_snapshot(Command::Verify {
            receipt: receipt.clone(),
        })
    })?;
    let activated = with_store(destination, env, |store| {
        store.transfer_ecdsa_snapshot(Command::Activate {
            receipt: receipt.clone(),
        })
    })?;
    assert_eq!(
        activated,
        Response::Activated {
            receipt: receipt.clone()
        }
    );
    assert_eq!(
        with_store(destination, env, |store| store.transfer_ecdsa_snapshot(
            Command::Activate {
                receipt: receipt.clone()
            }
        ))?,
        activated
    );
    Ok(())
}

fn reject_prepare_generation(
    path: &std::path::Path,
    env: &CloudflareEnvMapV1,
    scope: &CloudflareSigningWorkerWalletScopeV1,
    ownership_generation: u64,
    message: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut request = admitted_router_ab_ecdsa_derivation_digest_signing_request(
        router_ab_ecdsa_derivation_digest_signing_request(),
    );
    request.wallet_scope = scope.clone();
    request.ownership_generation = ownership_generation;
    let before = rows(path);
    let error = with_store(path, env, |store| {
        router_ab_cloudflare::prepare_signing_worker_wallet_ecdsa_from_pool_v1(
            store, request, 1_500, [0x33; 32],
        )
    })
    .unwrap_err();
    assert!(error.to_string().contains(message), "{error}");
    assert_eq!(rows(path), before, "stale preparation preserves pool bytes");
    Ok(())
}
