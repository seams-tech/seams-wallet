use super::*;
use router_ab_cloudflare::{
    CloudflareSigningWorkerWalletScopeV1, SigningWorkerWalletEcdsaStoreV1,
    SigningWorkerWalletSqlV1, SigningWorkerWalletSqlValueV1,
};
use router_ab_core::RouterAbProtocolError;
use rusqlite::{Connection, TransactionBehavior};
use serde::de::DeserializeOwned;

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
            SigningWorkerWalletSqlValueV1::Text(value) => rusqlite::types::Value::Text(value),
            SigningWorkerWalletSqlValueV1::Integer(value) => rusqlite::types::Value::Integer(value),
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
    with_store(&path, &env, |store| {
        store.activate(
            owner.clone(),
            activation_request.clone(),
            activation_material.clone(),
            1_000,
        )
    })?;
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
    let before = rows(&path);
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
    let freeze_request = router_ab_cloudflare::SigningWorkerPoolFreezeRequestV1 {
        move_id: format!("wmove_{}", "a".repeat(43)),
        source_generation: 1,
        invalidated_at_ms: 1_600,
    };
    let mut effect = admitted_router_ab_ecdsa_derivation_digest_finalize_request(
        router_ab_ecdsa_derivation_digest_signing_finalize_request(),
    );
    effect.wallet_scope = Some(owner.clone());
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
    let draining = freeze(&path, &env, &owner, freeze_request.clone())?;
    assert_eq!(
        draining,
        router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1::Draining { pending_effects: 1 }
    );
    assert_eq!(
        freeze(&path, &env, &owner, freeze_request.clone())?,
        draining
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
    let frozen = freeze(&path, &env, &owner, freeze_request.clone())?;
    let router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1::Frozen { receipt } = &frozen
    else {
        panic!("settled pool must freeze");
    };
    assert_eq!(receipt.record_count, 8);
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
    let exported_segments = verify_snapshot_export(&path, &env, receipt)?;
    let artifact = serde_json::json!({
        "scenario": "encrypted_pool_relocation", "records": 7,
        "available_and_reserved_destroyed": true, "reserved_binding_preserved": true,
        "consumed_retired_and_unrelated_bytes_preserved": true, "exact_retry_after_reopen": true,
        "changed_retry_rejected": true, "terminal_ids_cannot_be_repopulated": true,
        "pool_fence_survives_reopen": true,
        "pending_effect_blocks_freeze_until_commit": true,
        "presign_admission_closed_while_draining_and_frozen": true,
        "unrecorded_delayed_refill_rejected": true,
        "activation_writes_rejected_while_draining_and_frozen": true,
        "frozen_receipt_exact_retry": true,
        "snapshot_includes_pool_activation_and_terminal_effect": true,
        "snapshot_record_count": receipt.record_count,
        "exported_segments": exported_segments,
        "export_exact_after_reopen": true,
        "export_rejects_changed_receipt_and_bounds": true,
        "export_rejects_changed_source_inventory": true,
        "other_wallet_pool_admission_preserved": true,
        "scope": "Production wallet store and cipher on SQLite; excludes wallet-wide fencing and HTTP authorization"
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
    request: router_ab_cloudflare::SigningWorkerPoolFreezeRequestV1,
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
    let mut bytes = Vec::new();
    for segment_index in 0..first.segment_count {
        request.segment_index = segment_index;
        let chunk = with_store(path, env, |store| {
            store.export_ecdsa_snapshot(request.clone())
        })?;
        let retried = with_store(path, env, |store| {
            store.export_ecdsa_snapshot(request.clone())
        })?;
        assert_eq!(chunk, retried);
        let data = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&chunk.data_b64u)?;
        assert!(!data.is_empty() && data.len() <= 1_024);
        bytes.extend(data);
    }
    let (scope, move_request, snapshot): (
        CloudflareSigningWorkerWalletScopeV1,
        router_ab_cloudflare::SigningWorkerPoolFreezeRequestV1,
        serde_json::Value,
    ) = serde_json::from_slice(&bytes)?;
    assert_eq!(scope, receipt.scope);
    assert_eq!(move_request, receipt.request);
    assert_eq!(snapshot["pools"].as_array().unwrap().len(), 6);
    assert_eq!(snapshot["activations"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["effects"].as_array().unwrap().len(), 1);
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
    assert!(with_store(path, env, |store| store
        .export_ecdsa_snapshot(request.clone()))
    .is_err());
    database.execute(
        "UPDATE wallet_ecdsa_pool SET version = version - 1 WHERE owner_json = ?",
        [&owner_json],
    )?;
    assert_eq!(
        with_store(path, env, |store| store
            .export_ecdsa_snapshot(request.clone()))?,
        first,
    );
    Ok(first.segment_count)
}
