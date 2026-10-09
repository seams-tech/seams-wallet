use super::*;

/// The Router owns each registration's execution: it claims it in its wallet
/// object before running it, and records the terminal answer before replying.
/// Finalization consumes that record.
/// 1. While a registration runs, held at Deriver A's preparation, an exact
///    retry is told the execution is in progress.
/// 2. Released, the run succeeds. An exact retry gets the same bytes and runs
///    nothing; another request for the same lifecycle is refused.
/// 3. Consumption: the first consumer binding wins and replays; another is
///    refused, as are a mismatched session and an unknown lifecycle.
/// 4. After a Router restart, an exact retry still gets the recorded answer.
#[test]
fn vm_router_owns_each_registration_execution_and_its_consumption(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let mut stack = RecoveryStackV1::start("vm-router-wallet-object")?;
    let signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("router-wallet-object")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (registration, _) =
        stack.wallet_registration(&identity, &lineage_b64u, "account-router-wallet-object")?;
    let owner = router_ab_cloudflare::RouterWalletRegistrationV1::from_request(&registration)?
        .ok_or("registration owner")?
        .owner;
    let mut wrong_generation = serde_json::to_value(&registration)?;
    wrong_generation["target"]["ownership_generation"] = json!(2);
    let (wrong_status, wrong_body) = post_json_to_path_with_headers(
        &stack.router_url,
        "/router-ab/router/ed25519-yao/execute",
        &wrong_generation,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(wrong_status, 200, "{wrong_body}");
    assert!(
        wrong_body.contains("ownership generation does not match"),
        "{wrong_body}"
    );
    assert!(registration_rows(&stack.router_db, &owner, 1)?.is_empty());
    let export_generation_status = reject_export_probe(
        &stack.router_url,
        &registration,
        2,
        "ownership generation does not match",
    )?;
    let mut rejected_recovery = serde_json::to_value(&registration)?;
    rejected_recovery["target"]["operation"] = json!("recovery");
    rejected_recovery["target"]["ownership_generation"] = json!(2);
    rejected_recovery["target"]["attempt"] = json!(1);
    rejected_recovery["target"]["binding"]["operation"] = json!("recovery");
    rejected_recovery["target"]["binding"]["lifecycle"]["work_kind"] = json!("recovery");
    rejected_recovery["target"]["binding"]["lifecycle"]["primitive_request_kind"] =
        json!("recovery");
    rejected_recovery["target"]["deriver_a_input"]["operation"] = json!("recovery");
    rejected_recovery["target"]["deriver_b_input"]["operation"] = json!("recovery");
    // Validate the outer request. Its ciphertext must never reach a Deriver.
    let _: CloudflareRouterEd25519YaoExecuteRequestV2 =
        serde_json::from_value(rejected_recovery.clone())?;
    let (recovery_generation_status, recovery_generation_body) = post_json_to_path_with_headers(
        &stack.router_url,
        LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
        &rejected_recovery,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(
        recovery_generation_status, 200,
        "{recovery_generation_body}"
    );
    assert!(
        recovery_generation_body.contains("ownership generation does not match"),
        "{recovery_generation_body}"
    );
    assert!(registration_rows(&stack.router_db, &owner, 1)?.is_empty());
    let freeze = router_ab_cloudflare::RouterWalletFreezeRequestV1 {
        owner,
        move_id: format!("wmove_{}", "a".repeat(43)),
        request_digest_hex: "b".repeat(64),
        source_generation: 1,
        destination_generation: 2,
    };
    let mut destination = RecoveryStackV1::start("vm-router-wallet-import")?;
    let prepared = transfer_wallet(
        &destination.router_url,
        router_ab_cloudflare::RouterWalletTransferRequestV1::Prepare {
            request: freeze.clone(),
            chunk_bytes: 1024,
        },
    )?;
    assert!(matches!(
        prepared,
        router_ab_cloudflare::RouterWalletTransferResponseV1::Prepared { .. }
    ));
    let (recovery_destination_status, recovery_destination_body) = post_json_to_path_with_headers(
        &destination.router_url,
        LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
        &rejected_recovery,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(recovery_destination_status, 200, "{recovery_destination_body}");
    assert!(
        recovery_destination_body.contains("relocation has closed admission"),
        "{recovery_destination_body}"
    );
    let export_destination_status = reject_export_probe(
        &destination.router_url,
        &registration,
        2,
        "relocation has closed admission",
    )?;
    let a_pairs = |db: &Connection| -> rusqlite::Result<i64> {
        db.query_row(
            "SELECT COUNT(*) FROM local_deriver_a_yao_pairs",
            [],
            |row| row.get(0),
        )
    };

    // 1. A retry while the first run holds the claim.
    stack
        .proxy_a
        .hold_next_request_on(router_ab_dev::LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH);
    let running = {
        let router_url = stack.router_url.clone();
        let registration = registration.clone();
        thread::spawn(move || {
            post_json_to_path_with_headers(
                &router_url,
                LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
                &registration,
                &[(
                    LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                    TEST_GATEWAY_TO_ROUTER_AUTH,
                )],
            )
            .map_err(|error| error.to_string())
        })
    };
    let deadline = Instant::now() + Duration::from_secs(20);
    while stack.proxy_a.held_request().is_none() {
        if Instant::now() > deadline {
            return Err("the first run never reached Deriver A".into());
        }
        thread::sleep(Duration::from_millis(10));
    }
    let (in_progress_status, in_progress_body) = stack.register(&registration)?;
    assert_eq!(in_progress_status, 200, "{in_progress_body}");
    let in_progress: serde_json::Value = serde_json::from_str(&in_progress_body)?;
    assert_eq!(
        in_progress["status"], "recoverable_failure",
        "{in_progress}"
    );
    assert_eq!(
        in_progress["code"], "execution_in_progress",
        "{in_progress}"
    );
    let retry_after_ms = in_progress["retry_after_ms"]
        .as_u64()
        .ok_or("a retry hint")?;
    assert!(
        (1..=router_ab_cloudflare::ROUTER_WALLET_REGISTRATION_LEASE_MS_V1)
            .contains(&retry_after_ms),
        "{in_progress}"
    );
    let (unauthorized, _) = post_json_to_path_with_headers(
        &stack.router_url,
        router_ab_cloudflare::ROUTER_WALLET_FREEZE_PATH_V1,
        &freeze,
        &[],
    )?;
    assert_eq!(unauthorized, 401);
    let draining = freeze_wallet(&stack.router_url, &freeze)?;
    assert_eq!(draining["state"], "draining", "{draining}");
    let (delayed, _) =
        stack.wallet_registration(&identity, &lineage_b64u, "account-router-wallet-object")?;
    let (rejected, rejected_body) = stack.register(&delayed)?;
    assert_ne!(rejected, 200, "{rejected_body}");
    assert!(
        rejected_body.contains("LifecycleTransitionInProgress"),
        "{rejected_body}"
    );
    stack.proxy_a.release_request();
    let (first_status, first) = running.join().map_err(|_| "the first run panicked")??;
    assert_eq!(first_status, 200, "{first}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&first)?["status"],
        "succeeded"
    );
    assert_eq!(
        freeze_wallet(&stack.router_url, &freeze)?["state"],
        "draining",
        "the completed activation still needs its admitted finalization"
    );

    // 2. The recorded answer, and another request for the same lifecycle.
    let pairs_before = a_pairs(&stack.a_store)?;
    let (retry_status, retry) = stack.register(&registration)?;
    assert_eq!(retry_status, 200, "{retry}");
    assert_eq!(
        retry, first,
        "an exact retry gets the recorded answer, byte for byte"
    );
    assert_eq!(
        a_pairs(&stack.a_store)?,
        pairs_before,
        "an exact retry runs nothing"
    );
    // The same registration naming another custody lineage.
    let mut other = serde_json::to_value(&registration)?;
    let mut lineage_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(
        other["tenant_root"]["custody_lineage_b64u"]
            .as_str()
            .ok_or("a lineage")?,
    )?;
    lineage_bytes[0] ^= 1;
    other["tenant_root"]["custody_lineage_b64u"] =
        json!(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&lineage_bytes));
    let (mismatch_status, mismatch) = post_json_to_path_with_headers(
        &stack.router_url,
        LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
        &other,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_eq!(mismatch_status, 200, "{mismatch}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&mismatch)?,
        json!({ "status": "rejected", "code": "execution_mismatch" })
    );

    // 3. Consumption at the Router.
    let request = serde_json::to_value(&registration)?;
    let binding = &request["target"]["binding"];
    let consume = |lifecycle_id: &serde_json::Value,
                   session_id: &serde_json::Value,
                   consumer_binding: &str|
     -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let (status, body) = post_json_to_path_with_headers(
            &stack.router_url,
            router_ab_cloudflare::CLOUDFLARE_ROUTER_ED25519_YAO_REGISTRATION_CONSUME_PRIVATE_REQUEST_PATH,
            &json!({
                "tenant_root": request["tenant_root"],
                "ownership_generation": 1,
                "wallet_id": binding["lifecycle"]["account_id"],
                "lifecycle_id": lifecycle_id,
                "session_id": session_id,
                "consumer_binding": consumer_binding,
            }),
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
        )?;
        if status != 200 {
            return Err(format!("the consume call answered {status}: {body}").into());
        }
        Ok(serde_json::from_str(&body)?)
    };
    let lifecycle_id = &binding["lifecycle"]["lifecycle_id"];
    let session_id = &binding["session_id"];
    let (wrong_generation_status, wrong_generation_body) = post_json_to_path_with_headers(
        &stack.router_url,
        router_ab_cloudflare::CLOUDFLARE_ROUTER_ED25519_YAO_REGISTRATION_CONSUME_PRIVATE_REQUEST_PATH,
        &json!({
            "tenant_root": request["tenant_root"],
            "ownership_generation": 2,
            "wallet_id": binding["lifecycle"]["account_id"],
            "lifecycle_id": lifecycle_id,
            "session_id": session_id,
            "consumer_binding": "stale-owner",
        }),
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
    )?;
    assert_ne!(wrong_generation_status, 200, "{wrong_generation_body}");
    assert!(
        wrong_generation_body.contains("ownership generation does not match"),
        "{wrong_generation_body}"
    );
    let consumed = consume(lifecycle_id, session_id, "finalize-1")?;
    assert_eq!(consumed["kind"], "consumed", "{consumed}");
    assert_eq!(
        consumed["response_json"],
        json!(first),
        "consumption returns the recorded answer"
    );
    assert_eq!(consume(lifecycle_id, session_id, "finalize-1")?, consumed);
    let taken = consume(lifecycle_id, session_id, "finalize-2")?;
    assert_eq!(taken["kind"], "refused", "{taken}");
    assert_eq!(taken["code"], "activation_consumed", "{taken}");
    let mut other_session = session_id.clone();
    other_session[0] = json!((other_session[0].as_u64().ok_or("session byte")? + 1) % 256);
    let mismatched = consume(lifecycle_id, &other_session, "finalize-1")?;
    assert_eq!(
        mismatched["code"], "activation_reference_mismatch",
        "{mismatched}"
    );
    let unknown = consume(&json!("no-such-lifecycle"), session_id, "finalize-1")?;
    assert_eq!(unknown["code"], "unknown_registration", "{unknown}");
    restore_fixed_home_record_format(&stack.router_db, &freeze.owner)?;
    let historical_consumed = consume(lifecycle_id, session_id, "finalize-1")?;
    assert_eq!(historical_consumed["kind"], "consumed");
    assert_eq!(
        historical_consumed["response_json"],
        consumed["response_json"]
    );
    let (historical_retry_status, historical_retry_body) = stack.register(&registration)?;
    assert_eq!(historical_retry_status, 200, "{historical_retry_body}");
    assert_eq!(historical_retry_body, first);
    let sealed = freeze_wallet(&stack.router_url, &freeze)?;
    assert_eq!(sealed["state"], "frozen", "{sealed}");
    assert_eq!(sealed["receipt"]["record_count"], 1);
    assert_eq!(freeze_wallet(&stack.router_url, &freeze)?, sealed);
    rejected_recovery["target"]["ownership_generation"] = json!(1);
    let pairs_before_rejected_recovery = a_pairs(&stack.a_store)?;
    let export_frozen_status = reject_export_probe(
        &stack.router_url,
        &registration,
        1,
        "relocation has closed admission",
    )?;
    let (recovery_frozen_status, recovery_frozen_body) = post_json_to_path_with_headers(
        &stack.router_url,
        LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
        &rejected_recovery,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(recovery_frozen_status, 200, "{recovery_frozen_body}");
    assert!(
        recovery_frozen_body.contains("relocation has closed admission"),
        "{recovery_frozen_body}"
    );
    assert_eq!(a_pairs(&stack.a_store)?, pairs_before_rejected_recovery);
    assert_eq!(freeze_wallet(&stack.router_url, &freeze)?, sealed);
    let router_ab_cloudflare::RouterWalletFreezeResponseV1::Frozen { receipt } =
        serde_json::from_value(sealed.clone())?
    else {
        return Err("expected frozen receipt".into());
    };
    let (incomplete_status, _) = post_json_to_path_with_headers(
        &destination.router_url,
        router_ab_cloudflare::ROUTER_WALLET_TRANSFER_PATH_V1,
        &router_ab_cloudflare::RouterWalletTransferRequestV1::Verify {
            receipt: receipt.clone(),
        },
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(incomplete_status, 200);
    let (premature_activation, _) = post_json_to_path_with_headers(
        &destination.router_url,
        router_ab_cloudflare::ROUTER_WALLET_TRANSFER_PATH_V1,
        &router_ab_cloudflare::RouterWalletTransferRequestV1::Activate {
            receipt: receipt.clone(),
        },
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(premature_activation, 200);
    let status_command = router_ab_cloudflare::RouterWalletTransferRequestV1::Status {
        receipt: receipt.clone(),
        chunk_bytes: 1_024,
    };
    assert_eq!(
        transfer_wallet(&destination.router_url, status_command.clone())?,
        router_ab_cloudflare::RouterWalletTransferResponseV1::Receiving {
            receipt: receipt.clone(),
            chunk_bytes: 1_024,
            next_record: 0,
            next_segment: 0,
        }
    );
    let mut imported_segments = 0;
    let mut last_import = None;
    for record_index in 0..receipt.record_count {
        let first_chunk = export_wallet_chunk(&stack.router_url, &receipt, record_index, 0)?;
        assert!(
            first_chunk.segment_count > 1,
            "the E2E must exercise partial record import"
        );
        for segment_index in 0..first_chunk.segment_count {
            let chunk =
                export_wallet_chunk(&stack.router_url, &receipt, record_index, segment_index)?;
            let command = router_ab_cloudflare::RouterWalletTransferRequestV1::Import {
                chunk: chunk.clone(),
            };
            let acknowledgement = transfer_wallet(&destination.router_url, command.clone())?;
            imported_segments += 1;
            if imported_segments == 1 {
                assert!(registration_rows(&destination.router_db, &freeze.owner, 2)?.is_empty());
                destination.restart_router()?;
                assert_eq!(
                    transfer_wallet(&destination.router_url, status_command.clone())?,
                    router_ab_cloudflare::RouterWalletTransferResponseV1::Receiving {
                        receipt: receipt.clone(),
                        chunk_bytes: 1_024,
                        next_record: 0,
                        next_segment: 1,
                    },
                    "restart exposes the next durable segment after a lost reply"
                );
                assert_eq!(
                    transfer_wallet(&destination.router_url, command.clone())?,
                    acknowledgement,
                    "a lost import reply must replay its durable acknowledgement"
                );
                let mut changed_receipt = receipt.clone();
                changed_receipt.records_digest_hex = "f".repeat(64);
                let (status_conflict, _) = post_json_to_path_with_headers(
                    &destination.router_url,
                    router_ab_cloudflare::ROUTER_WALLET_TRANSFER_PATH_V1,
                    &router_ab_cloudflare::RouterWalletTransferRequestV1::Status {
                        receipt: changed_receipt,
                        chunk_bytes: 1_024,
                    },
                    &[(
                        LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                        TEST_GATEWAY_TO_ROUTER_AUTH,
                    )],
                )?;
                assert_ne!(status_conflict, 200);
                let mut changed = chunk;
                let mut bytes =
                    base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&changed.data_b64u)?;
                bytes[0] ^= 1;
                changed.data_b64u = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
                let (conflict, _) = post_json_to_path_with_headers(
                    &destination.router_url,
                    router_ab_cloudflare::ROUTER_WALLET_TRANSFER_PATH_V1,
                    &router_ab_cloudflare::RouterWalletTransferRequestV1::Import { chunk: changed },
                    &[(
                        LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                        TEST_GATEWAY_TO_ROUTER_AUTH,
                    )],
                )?;
                assert_ne!(conflict, 200);
            }
            last_import = Some((command, acknowledgement));
        }
    }
    assert_eq!(
        transfer_wallet(&destination.router_url, status_command.clone())?,
        router_ab_cloudflare::RouterWalletTransferResponseV1::Receiving {
            receipt: receipt.clone(),
            chunk_bytes: 1_024,
            next_record: receipt.record_count,
            next_segment: 0,
        }
    );
    let imported_rows = registration_rows(&destination.router_db, &freeze.owner, 2)?;
    assert_eq!(
        imported_rows,
        registration_rows(&stack.router_db, &freeze.owner, 1)?,
        "historical request and result bytes survive transfer exactly"
    );
    let verified = transfer_wallet(
        &destination.router_url,
        router_ab_cloudflare::RouterWalletTransferRequestV1::Verify {
            receipt: receipt.clone(),
        },
    )?;
    assert_eq!(
        verified,
        router_ab_cloudflare::RouterWalletTransferResponseV1::Verified {
            receipt: receipt.clone()
        }
    );
    destination.restart_router()?;
    assert_eq!(
        transfer_wallet(&destination.router_url, status_command.clone())?,
        verified
    );
    assert_eq!(
        transfer_wallet(
            &destination.router_url,
            router_ab_cloudflare::RouterWalletTransferRequestV1::Verify {
                receipt: receipt.clone()
            }
        )?,
        verified
    );
    let (last_command, last_acknowledgement) = last_import.ok_or("expected imported record")?;
    assert_eq!(
        transfer_wallet(&destination.router_url, last_command)?,
        last_acknowledgement
    );
    let mut destination_registration = registration.clone();
    if let router_ab_core::RouterEd25519YaoGatewayExecuteTargetV2::Registration {
        ownership_generation,
        ..
    } = &mut destination_registration.target
    {
        *ownership_generation = 2;
    }
    let (inactive_status, inactive_body) = destination.register(&destination_registration)?;
    assert_ne!(inactive_status, 200, "{inactive_body}");
    assert!(
        inactive_body.contains("LifecycleTransitionInProgress"),
        "{inactive_body}"
    );
    assert_eq!(
        registration_rows(&destination.router_db, &freeze.owner, 2)?,
        imported_rows
    );
    let mut conflict = freeze.clone();
    conflict.request_digest_hex = "c".repeat(64);
    let (conflict_status, _) = post_json_to_path_with_headers(
        &stack.router_url,
        router_ab_cloudflare::ROUTER_WALLET_FREEZE_PATH_V1,
        &conflict,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(conflict_status, 200);

    // 4. The record survives a Router restart.
    stack.restart_router()?;
    let (restarted_status, restarted) = stack.register(&registration)?;
    assert_eq!(restarted_status, 200, "{restarted}");
    assert_eq!(
        restarted, first,
        "after a restart, the recorded answer, byte for byte"
    );
    assert_eq!(freeze_wallet(&stack.router_url, &freeze)?, sealed);
    let (delayed_status, _) = stack.register(&delayed)?;
    assert_ne!(delayed_status, 200);
    assert_eq!(
        a_pairs(&stack.a_store)?,
        pairs_before,
        "the fence prevents new external work"
    );
    let (unrelated, _) =
        stack.wallet_registration(&identity, &lineage_b64u, "unrelated-router-wallet")?;
    let (unrelated_status, unrelated_answer) = stack.register(&unrelated)?;
    assert_eq!(unrelated_status, 200, "{unrelated_answer}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&unrelated_answer)?["status"],
        "succeeded"
    );
    assert_eq!(freeze_wallet(&stack.router_url, &freeze)?, sealed);
    let (empty_registration, _) =
        stack.wallet_registration(&identity, &lineage_b64u, "empty-router-wallet")?;
    let empty_owner =
        router_ab_cloudflare::RouterWalletRegistrationV1::from_request(&empty_registration)?
            .ok_or("empty inventory owner")?
            .owner;
    let empty_move = router_ab_cloudflare::RouterWalletFreezeRequestV1 {
        owner: empty_owner,
        move_id: format!("wmove_{}", "e".repeat(43)),
        request_digest_hex: "f".repeat(64),
        source_generation: 1,
        destination_generation: 2,
    };
    transfer_wallet(
        &destination.router_url,
        router_ab_cloudflare::RouterWalletTransferRequestV1::Prepare {
            request: empty_move.clone(),
            chunk_bytes: 1024,
        },
    )?;
    let empty_frozen = freeze_wallet(&stack.router_url, &empty_move)?;
    let router_ab_cloudflare::RouterWalletFreezeResponseV1::Frozen {
        receipt: empty_receipt,
    } = serde_json::from_value(empty_frozen.clone())?
    else {
        return Err("expected an empty frozen inventory".into());
    };
    assert_eq!(empty_receipt.record_count, 0);
    let empty_verified = transfer_wallet(
        &destination.router_url,
        router_ab_cloudflare::RouterWalletTransferRequestV1::Verify {
            receipt: empty_receipt.clone(),
        },
    )?;
    assert_eq!(
        empty_verified,
        router_ab_cloudflare::RouterWalletTransferResponseV1::Verified {
            receipt: empty_receipt,
        }
    );
    stack.restart_router()?;
    destination.restart_router()?;
    assert_eq!(freeze_wallet(&stack.router_url, &empty_move)?, empty_frozen);
    let pairs_before_empty_retry = a_pairs(&stack.a_store)?;
    let (empty_source_status, _) = stack.register(&empty_registration)?;
    let (empty_destination_status, _) = destination.register(&empty_registration)?;
    assert_ne!(empty_source_status, 200);
    assert_ne!(empty_destination_status, 200);
    assert_eq!(a_pairs(&stack.a_store)?, pairs_before_empty_retry);
    assert!(registration_rows(&stack.router_db, &empty_move.owner, 1)?.is_empty());
    assert!(registration_rows(&destination.router_db, &empty_move.owner, 2)?.is_empty());
    assert_eq!(
        registration_rows(&destination.router_db, &freeze.owner, 2)?,
        imported_rows
    );
    let (unrelated_retry_status, unrelated_retry) = stack.register(&unrelated)?;
    assert_eq!(unrelated_retry_status, 200);
    assert_eq!(unrelated_retry, unrelated_answer);
    drop(signing_worker);
    verify_pool_freeze_transport(&stack, &destination)?;
    // Returning to the original region prepares a fresh object beside its frozen source.
    let return_move = router_ab_cloudflare::RouterWalletFreezeRequestV1 {
        owner: freeze.owner.clone(),
        move_id: format!("wmove_{}", "r".repeat(43)),
        request_digest_hex: "c".repeat(64),
        source_generation: 2,
        destination_generation: 3,
    };
    let return_preparation = router_ab_cloudflare::RouterWalletTransferRequestV1::Prepare {
        request: return_move.clone(),
        chunk_bytes: 1024,
    };
    let return_receipt = transfer_wallet(&stack.router_url, return_preparation.clone())?;
    stack.restart_router()?;
    assert_eq!(
        transfer_wallet(&stack.router_url, return_preparation)?,
        return_receipt,
        "return preparation replays in its generation-specific object"
    );
    assert_eq!(freeze_wallet(&stack.router_url, &freeze)?, sealed);
    assert_eq!(
        registration_rows(&stack.router_db, &freeze.owner, 1)?,
        imported_rows
    );
    assert!(registration_rows(&stack.router_db, &freeze.owner, 3)?.is_empty());
    reject_export_probe(
        &stack.router_url,
        &registration,
        3,
        "relocation has closed admission",
    )?;

    let activation_command = router_ab_cloudflare::RouterWalletTransferRequestV1::Activate {
        receipt: receipt.clone(),
    };
    assert_eq!(
        post_json_to_path_with_headers(
            &destination.router_url,
            router_ab_cloudflare::ROUTER_WALLET_TRANSFER_PATH_V1,
            &activation_command,
            &[],
        )?
        .0,
        401
    );
    let mut conflicting_receipt = receipt.clone();
    conflicting_receipt.records_digest_hex = "0".repeat(64);
    let (activation_conflict, _) = post_json_to_path_with_headers(
        &destination.router_url,
        router_ab_cloudflare::ROUTER_WALLET_TRANSFER_PATH_V1,
        &router_ab_cloudflare::RouterWalletTransferRequestV1::Activate {
            receipt: conflicting_receipt,
        },
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(activation_conflict, 200);
    let activation = activate_router_wallet(&destination.router_url, &receipt)?;
    destination.restart_router()?;
    assert_eq!(
        activate_router_wallet(&destination.router_url, &receipt)?,
        activation
    );
    assert_router_consumption_replay(
        &destination.router_url,
        &registration,
        2,
        &historical_consumed,
    )?;
    let mut changed_activation = activation.clone();
    assert_eq!(
        post_json_to_path_with_headers(
            &stack.router_url,
            router_ab_cloudflare::ROUTER_WALLET_TRANSFER_PATH_V1,
            &router_ab_cloudflare::RouterWalletTransferRequestV1::Cleanup {
                activation: activation.clone()
            },
            &[],
        )?
        .0,
        401
    );
    changed_activation.destination_object.push('x');
    let (cleanup_conflict, _) = post_json_to_path_with_headers(
        &stack.router_url,
        router_ab_cloudflare::ROUTER_WALLET_TRANSFER_PATH_V1,
        &router_ab_cloudflare::RouterWalletTransferRequestV1::Cleanup {
            activation: changed_activation,
        },
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(cleanup_conflict, 200);
    assert_eq!(
        registration_rows(&stack.router_db, &freeze.owner, 1)?,
        imported_rows
    );
    assert_router_consumption_replay(
        &destination.router_url,
        &registration,
        2,
        &historical_consumed,
    )?;
    cleanup_router_wallet(&mut stack, &activation)?;
    assert!(registration_rows(&stack.router_db, &freeze.owner, 1)?.is_empty());
    assert_ne!(stack.register(&registration)?.0, 200);
    assert_eq!(freeze_wallet(&stack.router_url, &freeze)?, sealed);

    let returned_source = freeze_wallet(&destination.router_url, &return_move)?;
    let router_ab_cloudflare::RouterWalletFreezeResponseV1::Frozen {
        receipt: return_snapshot,
    } = serde_json::from_value(returned_source.clone())?
    else {
        return Err("return source did not freeze".into());
    };
    // Replaying the first activation must not remove the next move's source fence.
    assert_eq!(
        activate_router_wallet(&destination.router_url, &receipt)?,
        activation
    );
    assert_eq!(
        freeze_wallet(&destination.router_url, &return_move)?,
        returned_source
    );
    for record_index in 0..return_snapshot.record_count {
        let first =
            export_wallet_chunk(&destination.router_url, &return_snapshot, record_index, 0)?;
        for segment_index in 0..first.segment_count {
            let chunk = export_wallet_chunk(
                &destination.router_url,
                &return_snapshot,
                record_index,
                segment_index,
            )?;
            transfer_wallet(
                &stack.router_url,
                router_ab_cloudflare::RouterWalletTransferRequestV1::Import { chunk },
            )?;
        }
    }
    transfer_wallet(
        &stack.router_url,
        router_ab_cloudflare::RouterWalletTransferRequestV1::Verify {
            receipt: return_snapshot.clone(),
        },
    )?;
    let returned_activation = activate_router_wallet(&stack.router_url, &return_snapshot)?;
    assert_router_consumption_replay(&stack.router_url, &registration, 3, &historical_consumed)?;

    assert!(cleanup_router_wallet(&mut destination, &returned_activation)? > 1);
    assert!(registration_rows(&destination.router_db, &freeze.owner, 2)?.is_empty());
    assert_eq!(
        activate_router_wallet(&destination.router_url, &receipt)?,
        activation
    );
    assert_eq!(
        transfer_wallet(&destination.router_url, status_command)?,
        router_ab_cloudflare::RouterWalletTransferResponseV1::Activated {
            activation: activation.clone()
        },
        "historical import status does not reopen a cleaned generation"
    );
    assert_ne!(destination.register(&destination_registration)?.0, 200);
    assert_router_consumption_replay(&stack.router_url, &registration, 3, &historical_consumed)?;

    println!(
        "ROUTER_WALLET_ACTIVATION_E2E {}",
        json!({
            "activation_requires_verification": true,
            "activation_replays_after_restart": true,
            "cleanup_failure_preserves_active_destination": true,
            "return_preserves_consumption_result": true,
            "cleanup_resumes_bounded_batches_after_restart": true,
            "old_activation_retry_never_reopens_retired_source": true,
        })
    );

    println!(
        "SIGNING_WORKER_IMPORT_PROGRESS_E2E {}",
        json!({
            "cursor_survives_restart": true,
            "changed_manifest_rejected": true,
            "verified_status_survives_restart": true,
            "activation_requires_verification_and_role_credential": true,
            "activation_receipt_survives_restart": true,
            "cleanup_rejects_wrong_role_credential_and_destination": true,
            "cleanup_completion_replays": true,
        })
    );

    println!(
        "R150_VM_ROUTER_WALLET_OBJECT_E2E {}",
        json!({
            "retry_while_claimed": [in_progress["code"], retry_after_ms],
            "first_run": "succeeded",
            "wrong_execution_generation_rejected": wrong_status,
            "export_wrong_generation_rejected": export_generation_status,
            "export_frozen_source_rejected": export_frozen_status,
            "export_inactive_destination_rejected": export_destination_status,
            "recovery_wrong_generation_rejected": recovery_generation_status,
            "recovery_frozen_source_rejected": recovery_frozen_status,
            "recovery_inactive_destination_rejected": recovery_destination_status,
            "exact_retry": "recorded answer, byte for byte, no new pair",
            "same_lifecycle_other_lineage": "execution_mismatch",
            "consume": {
                "wrong_ownership_generation_rejected": wrong_generation_status,
                "first_binding": consumed["kind"],
                "same_binding_replays": true,
                "other_binding": taken["code"],
                "other_session": mismatched["code"],
                "unknown_lifecycle": unknown["code"],
            },
            "after_router_restart": "recorded answer, byte for byte",
            "relocation": {
                "unauthenticated_freeze_rejected": true,
                "drained_existing_claim_and_consumption": true,
                "delayed_registration_rejected_after_restart": true,
                "unrelated_wallet_registered": true,
                "immutable_receipt": sealed,
                "imported_segments": imported_segments,
                "destination_verified_but_inactive": true,
                "lost_chunk_reply_replayed_after_restart": true,
                "durable_import_cursor_survives_restart": true,
                "status_rejects_changed_manifest": true,
                "status_never_reopens_cleaned_generation": true,
                "exact_historical_record_bytes": true,
                "fixed_home_history_replays_and_transfers": true,
                "pool_freeze_transport_authenticated_and_replayed": true,
                "linked_inventory_empty_page_replays_after_restart": true,
                "linked_inventory_rejects_unrelated_credentials_and_changed_move": true,
                "ecdsa_empty_destination_verified_after_restart": true,
                "ecdsa_import_acknowledgement_replayed_after_restart": true,
                "ecdsa_transfer_rejects_unrelated_credentials": true,
                "empty_inventory_verified_without_chunks": true,
                "empty_inventory_fences_survive_restart": true,
                "empty_inventory_preserves_other_wallets": true,
                "return_preparation_preserves_frozen_source": true,
                "return_preparation_replays_after_restart": true,
                "return_destination_stays_inactive": true,
            },
        })
    );
    Ok(())
}

fn activate_router_wallet(
    router_url: &str,
    receipt: &router_ab_cloudflare::RouterWalletFreezeReceiptV1,
) -> Result<router_ab_cloudflare::RouterWalletActivationReceiptV1, Box<dyn std::error::Error>> {
    match transfer_wallet(
        router_url,
        router_ab_cloudflare::RouterWalletTransferRequestV1::Activate {
            receipt: receipt.clone(),
        },
    )? {
        router_ab_cloudflare::RouterWalletTransferResponseV1::Activated { activation } => {
            Ok(activation)
        }
        _ => Err("Router returned an unexpected activation response".into()),
    }
}

fn assert_router_consumption_replay(
    router_url: &str,
    registration: &CloudflareRouterEd25519YaoExecuteRequestV2,
    generation: u64,
    expected: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let request = serde_json::to_value(registration)?;
    let binding = &request["target"]["binding"];
    let (status, body) = post_json_to_path_with_headers(
        router_url,
        router_ab_cloudflare::CLOUDFLARE_ROUTER_ED25519_YAO_REGISTRATION_CONSUME_PRIVATE_REQUEST_PATH,
        &json!({
            "tenant_root": request["tenant_root"],
            "ownership_generation": generation,
            "wallet_id": binding["lifecycle"]["account_id"],
            "lifecycle_id": binding["lifecycle"]["lifecycle_id"],
            "session_id": binding["session_id"],
            "consumer_binding": "finalize-1",
        }),
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, TEST_GATEWAY_TO_ROUTER_AUTH)],
    )?;
    assert_eq!(status, 200, "{body}");
    assert_eq!(serde_json::from_str::<serde_json::Value>(&body)?, *expected);
    Ok(())
}

fn cleanup_router_wallet(
    source: &mut RecoveryStackV1,
    activation: &router_ab_cloudflare::RouterWalletActivationReceiptV1,
) -> Result<usize, Box<dyn std::error::Error>> {
    let command = router_ab_cloudflare::RouterWalletTransferRequestV1::Cleanup {
        activation: activation.clone(),
    };
    for call in 1..=10 {
        let response = transfer_wallet(&source.router_url, command.clone())?;
        source.restart_router()?;
        match response {
            router_ab_cloudflare::RouterWalletTransferResponseV1::Cleaning {
                activation: receipt,
            } => {
                assert_eq!(&receipt, activation);
            }
            router_ab_cloudflare::RouterWalletTransferResponseV1::Cleaned { .. } => {
                assert_eq!(transfer_wallet(&source.router_url, command)?, response);
                return Ok(call);
            }
            _ => return Err("Router returned an unexpected cleanup response".into()),
        }
    }
    Err("Router cleanup exceeded the fixture's bounded inventory".into())
}

fn transfer_wallet(
    router_url: &str,
    request: router_ab_cloudflare::RouterWalletTransferRequestV1,
) -> Result<router_ab_cloudflare::RouterWalletTransferResponseV1, Box<dyn std::error::Error>> {
    let (status, body) = post_json_to_path_with_headers(
        router_url,
        router_ab_cloudflare::ROUTER_WALLET_TRANSFER_PATH_V1,
        &request,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_eq!(status, 200, "{body}");
    Ok(serde_json::from_str(&body)?)
}

fn export_wallet_chunk(
    router_url: &str,
    receipt: &router_ab_cloudflare::RouterWalletFreezeReceiptV1,
    record_index: u64,
    segment_index: u32,
) -> Result<router_ab_cloudflare::RouterWalletTransferChunkV1, Box<dyn std::error::Error>> {
    match transfer_wallet(
        router_url,
        router_ab_cloudflare::RouterWalletTransferRequestV1::Export {
            receipt: receipt.clone(),
            record_index,
            segment_index,
            chunk_bytes: 1024,
        },
    )? {
        router_ab_cloudflare::RouterWalletTransferResponseV1::Exported { chunk } => Ok(chunk),
        _ => Err("Router returned an unexpected export response".into()),
    }
}

fn restore_fixed_home_record_format(
    database: &Connection,
    owner: &router_ab_cloudflare::RouterWalletOwnerV1,
) -> Result<(), Box<dyn std::error::Error>> {
    let records = registration_rows(database, owner, 1)?;
    assert_eq!(records.len(), 1);
    for (key, encoded) in records {
        let mut record: serde_json::Value = serde_json::from_str(&encoded)?;
        let mut request: serde_json::Value = serde_json::from_str(
            record["request_json"]
                .as_str()
                .ok_or("missing stored request")?,
        )?;
        request["target"]
            .as_object_mut()
            .ok_or("missing target")?
            .remove("ownership_generation")
            .ok_or("missing generation")?;
        let request_json = serde_json::to_string(&request)?;
        let mut hash = Sha256::new();
        hash.update(b"seams/router/yao-registration-request/v1");
        hash.update(request_json.as_bytes());
        record["request_digest_hex"] = json!(hex::encode(hash.finalize()));
        record["request_json"] = json!(request_json);
        let stored: router_ab_cloudflare::RouterWalletRegistrationRecordV1 =
            serde_json::from_value(record)?;
        assert_eq!(database.execute(
            "UPDATE local_router_wallet_objects SET value_json = ?1 WHERE object_name = ?2 AND storage_key = ?3",
            rusqlite::params![serde_json::to_string(&stored)?, owner.object_name(1)?, key],
        )?, 1);
    }
    Ok(())
}

fn registration_rows(
    database: &Connection,
    owner: &router_ab_cloudflare::RouterWalletOwnerV1,
    ownership_generation: u64,
) -> Result<Vec<(String, String)>, Box<dyn std::error::Error>> {
    let mut query = database.prepare(
        "SELECT storage_key, value_json FROM local_router_wallet_objects
        WHERE object_name = ?1 AND storage_key LIKE 'yao-registration/%' ORDER BY storage_key",
    )?;
    let records = query
        .query_map([owner.object_name(ownership_generation)?], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(records)
}

fn freeze_wallet(
    router_url: &str,
    request: &router_ab_cloudflare::RouterWalletFreezeRequestV1,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let (status, body) = post_json_to_path_with_headers(
        router_url,
        router_ab_cloudflare::ROUTER_WALLET_FREEZE_PATH_V1,
        request,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_eq!(status, 200, "{body}");
    Ok(serde_json::from_str(&body)?)
}

/// A run that resumes after another run took its lapsed claim over cannot
/// record its answer: the Router's wallet object records only the answer of
/// the run holding the current claim generation.
/// 1. The first run is paused after both Derivers completed its pair: Deriver
///    A's answer to the Router is held.
/// 2. Its one-second lease lapses, and a freeze command takes the claim over as
///    generation 2. It replays: it reads both Derivers' pair status, and is
///    paused reading Deriver B's.
/// 3. The first run resumes and completes, but the claim is no longer its: it
///    is told the execution is in progress, and the claim stays generation
///    2's.
/// 4. The takeover run resumes, reconciles the completed pair and records its
///    answer. An exact retry gets that answer, byte for byte, and prepares no
///    pair.
#[test]
fn vm_router_run_that_lost_its_claim_cannot_record_its_answer(
) -> Result<(), Box<dyn std::error::Error>> {
    const LEASE_MS: u64 = 1_000;
    let _process_guard = local_worker_process_test_guard();
    let stack = RecoveryStackV1::start_with_router_env(
        "vm-router-wallet-claim-takeover",
        &[("ROUTER_YAO_REGISTRATION_LEASE_MS", "1000")],
    )?;
    let signing_worker = stack.start_signing_worker()?;
    let (identity, lineage, lineage_b64u) = recovery_ceremony("router-wallet-claim-takeover")?;
    let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
    let (status, body) = stack.create(&grant)?;
    assert_eq!(status, 200, "{body}");
    let (registration, _) =
        stack.wallet_registration(&identity, &lineage_b64u, "account-claim-takeover")?;
    let lifecycle_id = serde_json::to_value(&registration)?["target"]["binding"]["lifecycle"]
        ["lifecycle_id"]
        .as_str()
        .ok_or("a lifecycle id")?
        .to_owned();
    let run = || {
        let router_url = stack.router_url.clone();
        let registration = registration.clone();
        thread::spawn(move || {
            post_json_to_path_with_headers(
                &router_url,
                LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
                &registration,
                &[(
                    LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                    TEST_GATEWAY_TO_ROUTER_AUTH,
                )],
            )
            .map_err(|error| error.to_string())
        })
    };
    let wait_for =
        |what: &str, ready: &dyn Fn() -> bool| -> Result<(), Box<dyn std::error::Error>> {
            let deadline = Instant::now() + Duration::from_secs(15);
            while !ready() {
                if Instant::now() > deadline {
                    return Err(format!("timed out waiting for {what}").into());
                }
                thread::sleep(Duration::from_millis(10));
            }
            Ok(())
        };
    let pair_states = |db: &Connection, table: &str| -> rusqlite::Result<Vec<String>> {
        db.prepare(&format!(
            "SELECT json_extract(record_json, '$.status') FROM {table}"
        ))?
        .query_map([], |row| row.get(0))?
        .collect()
    };
    let router_record = || -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let json: String = stack.router_db.query_row(
            "SELECT value_json FROM local_router_wallet_objects WHERE storage_key = ?1",
            [format!("yao-registration/{lifecycle_id}")],
            |row| row.get(0),
        )?;
        Ok(serde_json::from_str(&json)?)
    };

    // 1. The first run, paused once both Derivers completed its pair.
    stack
        .proxy_a
        .hold_next_response_on(LOCAL_DERIVER_A_ED25519_YAO_EXECUTE_PAIR_PATH);
    let first_claimed_at = Instant::now();
    let first = run();
    wait_for("Deriver A's answer to the first run", &|| {
        stack.proxy_a.holding()
    })?;
    assert_eq!(
        pair_states(&stack.a_store, "local_deriver_a_yao_pairs")?,
        vec!["completed"]
    );
    assert_eq!(
        pair_states(&stack.b_store, "local_deriver_b_yao_pairs")?,
        vec!["completed"]
    );
    let first_claim = router_record()?;
    assert_eq!(
        (&first_claim["kind"], &first_claim["generation"]),
        (&json!("claimed"), &json!(1)),
        "{first_claim}"
    );

    // 2. The lease lapses. A freeze command takes the claim over and is paused
    //    reading Deriver B's pair status.
    thread::sleep(Duration::from_millis(LEASE_MS + 250).saturating_sub(first_claimed_at.elapsed()));
    stack
        .proxy_b
        .hold_next_request_on(router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH);
    let freeze = router_ab_cloudflare::RouterWalletFreezeRequestV1 {
        owner: router_ab_cloudflare::RouterWalletRegistrationV1::from_request(&registration)?
            .ok_or("registration owner")?
            .owner,
        move_id: format!("wmove_{}", "t".repeat(43)),
        request_digest_hex: "8".repeat(64),
        source_generation: 1,
        destination_generation: 2,
    };
    let takeover = {
        let router_url = stack.router_url.clone();
        let freeze = freeze.clone();
        thread::spawn(move || {
            freeze_wallet(&router_url, &freeze).map_err(|error| error.to_string())
        })
    };
    wait_for("the takeover run's status read at Deriver B", &|| {
        stack.proxy_b.held_request().is_some()
    })?;
    let taken_over = router_record()?;
    assert_eq!(
        (&taken_over["kind"], &taken_over["generation"]),
        (&json!("claimed"), &json!(2)),
        "{taken_over}"
    );

    // 3. The first run resumes and completes, but cannot record its answer.
    stack.proxy_a.release_held();
    let (first_status, first_body) = first.join().map_err(|_| "the first run panicked")??;
    assert_eq!(first_status, 200, "{first_body}");
    let fenced: serde_json::Value = serde_json::from_str(&first_body)?;
    assert_eq!(fenced["status"], "recoverable_failure", "{fenced}");
    assert_eq!(fenced["code"], "execution_in_progress", "{fenced}");
    let retry_after_ms = fenced["retry_after_ms"].as_u64().ok_or("a retry hint")?;
    assert!((1..=LEASE_MS).contains(&retry_after_ms), "{fenced}");
    let still_claimed = router_record()?;
    assert_eq!(
        (&still_claimed["kind"], &still_claimed["generation"]),
        (&json!("claimed"), &json!(2)),
        "the first run recorded nothing: {still_claimed}"
    );

    // 4. The takeover run resumes, reconciles and records its answer.
    stack.proxy_b.release_request();
    let takeover_freeze = takeover.join().map_err(|_| "the takeover run panicked")??;
    assert_eq!(
        takeover_freeze["state"], "draining",
        "activation still needs its Gateway consumer"
    );
    let recorded = router_record()?;
    assert_eq!(recorded["kind"], "completed", "{recorded}");
    let takeover_body = recorded["response_json"]
        .as_str()
        .ok_or("a recorded result")?;
    assert!(registration_succeeded(takeover_body)?, "{takeover_body}");
    assert_eq!(freeze_wallet(&stack.router_url, &freeze)?, takeover_freeze);
    assert_eq!(
        router_record()?,
        recorded,
        "freeze retry leaves the result unchanged"
    );
    let (retry_status, retry) = stack.register(&registration)?;
    assert_eq!(retry_status, 200, "{retry}");
    assert_eq!(
        retry, takeover_body,
        "an exact retry gets the recorded answer, byte for byte"
    );
    assert_eq!(
        pair_states(&stack.a_store, "local_deriver_a_yao_pairs")?,
        vec!["completed"]
    );
    assert_eq!(
        pair_states(&stack.b_store, "local_deriver_b_yao_pairs")?,
        vec!["completed"]
    );
    drop(signing_worker);
    println!(
        "R150_VM_ROUTER_CLAIM_TAKEOVER_E2E {}",
        json!({
            "lease_ms": LEASE_MS,
            "first_run_paused_after": "both Derivers completed its pair",
            "first_claim_generation": first_claim["generation"],
            "takeover_generation": taken_over["generation"],
            "takeover_paused_at": "Deriver B pair status read",
            "first_run_resumed": [fenced["status"], fenced["code"], retry_after_ms],
            "claim_after_first_run_resumed": [still_claimed["kind"], still_claimed["generation"]],
            "takeover_run": "freeze reconciled the stored request and recorded its answer",
            "freeze_waits_for_gateway_consumption": true,
            "freeze_retry_preserves_completed_record": true,
            "exact_retry": "the takeover run's answer, byte for byte, no new pair",
        })
    );
    Ok(())
}

fn verify_pool_freeze_transport(
    stack: &RecoveryStackV1,
    destination: &RecoveryStackV1,
) -> Result<(), Box<dyn std::error::Error>> {
    let worker = stack.start_signing_worker()?;
    let entries = parse_local_env_file_contents_v1(&std::fs::read_to_string(
        stack
            .temp
            .join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1),
    )?)?;
    let LocalWorkerRoleConfigV1::SigningWorker(config) =
        parse_local_worker_role_config_for_role_v1(LocalServiceRoleV1::SigningWorker, entries)?
    else {
        return Err("expected SigningWorker configuration".into());
    };
    let command = router_ab_cloudflare::SigningWorkerPoolFreezeCommandV1 {
        scope: router_ab_cloudflare::CloudflareSigningWorkerWalletScopeV1::new(
            "local-org",
            "local-project",
            "router-wallet-object",
            "account-router-wallet-object",
        )?,
        request: router_ab_cloudflare::SigningWorkerRelocationRequestV1 {
            move_id: format!("wmove_{}", "p".repeat(43)),
            source_generation: 1,
            invalidated_at_ms: 1_900_000_000_000,
        },
    };
    for credential in [
        "",
        TEST_ROLE_SHARED_SERVICE_AUTH,
        TEST_GATEWAY_TO_ROUTER_AUTH,
    ] {
        let (status, _) = post_json_to_path_with_headers(
            &stack.signing_worker_url,
            router_ab_cloudflare::SIGNING_WORKER_POOL_FREEZE_PATH_V1,
            &command,
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, credential)],
        )?;
        assert_ne!(
            status, 200,
            "another service credential cannot freeze a pool"
        );
    }
    let headers = [(
        LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
        config.router_to_signing_worker_ecdsa_auth.as_str(),
    )];
    let (status, body) = post_json_to_path_with_headers(
        &stack.signing_worker_url,
        router_ab_cloudflare::SIGNING_WORKER_POOL_FREEZE_PATH_V1,
        &command,
        &headers,
    )?;
    assert_eq!(status, 200, "{body}");
    let router_ab_cloudflare::SigningWorkerPoolFreezeResponseV1::Frozen { receipt } =
        serde_json::from_str(&body)?
    else {
        return Err("expected a frozen empty pool".into());
    };
    assert_eq!(receipt.scope, command.scope);
    assert_eq!(receipt.record_count, 0);
    let inventory_request = router_ab_cloudflare::SigningWorkerLinkedPresignInventoryRequestV1 {
        scope: receipt.scope.clone(),
        request: receipt.request.clone(),
        cursor: router_ab_cloudflare::SigningWorkerLinkedPresignCursorV1::Start,
        limit: 1,
    };
    for credential in ["", TEST_ROLE_SHARED_SERVICE_AUTH, TEST_GATEWAY_TO_ROUTER_AUTH] {
        let (status, _) = post_json_to_path_with_headers(
            &stack.signing_worker_url,
            router_ab_cloudflare::SIGNING_WORKER_LINKED_PRESIGN_INVENTORY_PATH_V1,
            &inventory_request,
            &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, credential)],
        )?;
        assert_ne!(status, 200, "another service credential cannot read inventory");
    }
    let (inventory_status, inventory_body) = post_json_to_path_with_headers(
        &stack.signing_worker_url,
        router_ab_cloudflare::SIGNING_WORKER_LINKED_PRESIGN_INVENTORY_PATH_V1,
        &inventory_request,
        &headers,
    )?;
    assert_eq!(inventory_status, 200, "{inventory_body}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&inventory_body)?,
        json!({ "state": "complete", "sessions": [] })
    );
    let mut changed_inventory = inventory_request.clone();
    changed_inventory.request.invalidated_at_ms += 1;
    let (changed_inventory_status, _) = post_json_to_path_with_headers(
        &stack.signing_worker_url,
        router_ab_cloudflare::SIGNING_WORKER_LINKED_PRESIGN_INVENTORY_PATH_V1,
        &changed_inventory,
        &headers,
    )?;
    assert_ne!(changed_inventory_status, 200);
    let export_request = router_ab_cloudflare::SigningWorkerEcdsaExportRequestV1 {
        receipt,
        segment_index: 0,
        chunk_bytes: 1_024,
    };
    let (unauthorized_status, _) = post_json_to_path_with_headers(
        &stack.signing_worker_url,
        router_ab_cloudflare::SIGNING_WORKER_ECDSA_EXPORT_PATH_V1,
        &export_request,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(unauthorized_status, 200);
    let (export_status, export_body) = post_json_to_path_with_headers(
        &stack.signing_worker_url,
        router_ab_cloudflare::SIGNING_WORKER_ECDSA_EXPORT_PATH_V1,
        &export_request,
        &headers,
    )?;
    assert_eq!(export_status, 200, "{export_body}");
    drop(worker);
    let _restarted = stack.start_signing_worker()?;
    let (retry_status, retry_body) = post_json_to_path_with_headers(
        &stack.signing_worker_url,
        router_ab_cloudflare::SIGNING_WORKER_POOL_FREEZE_PATH_V1,
        &command,
        &headers,
    )?;
    assert_eq!(retry_status, 200, "{retry_body}");
    assert_eq!(retry_body, body);
    let (export_retry_status, export_retry_body) = post_json_to_path_with_headers(
        &stack.signing_worker_url,
        router_ab_cloudflare::SIGNING_WORKER_ECDSA_EXPORT_PATH_V1,
        &export_request,
        &headers,
    )?;
    assert_eq!(export_retry_status, 200, "{export_retry_body}");
    assert_eq!(export_retry_body, export_body);
    let (inventory_retry_status, inventory_retry_body) = post_json_to_path_with_headers(
        &stack.signing_worker_url,
        router_ab_cloudflare::SIGNING_WORKER_LINKED_PRESIGN_INVENTORY_PATH_V1,
        &inventory_request,
        &headers,
    )?;
    assert_eq!(inventory_retry_status, 200, "{inventory_retry_body}");
    assert_eq!(inventory_retry_body, inventory_body);
    verify_ecdsa_destination_transport(
        stack,
        destination,
        &config.router_to_signing_worker_ecdsa_auth,
        &export_request.receipt,
    )?;
    let mut changed = command;
    changed.request.source_generation = 2;
    let (conflict_status, _) = post_json_to_path_with_headers(
        &stack.signing_worker_url,
        router_ab_cloudflare::SIGNING_WORKER_POOL_FREEZE_PATH_V1,
        &changed,
        &headers,
    )?;
    assert_ne!(conflict_status, 200);
    Ok(())
}

fn transfer_ecdsa_http(
    base_url: &str,
    credential: &str,
    command: &router_ab_cloudflare::SigningWorkerEcdsaTransferRequestV1,
) -> Result<(u16, String), Box<dyn std::error::Error>> {
    post_json_to_path_with_headers(
        base_url,
        router_ab_cloudflare::SIGNING_WORKER_ECDSA_TRANSFER_PATH_V1,
        command,
        &[(LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, credential)],
    )
}

fn verify_ecdsa_destination_transport(
    source: &RecoveryStackV1,
    destination: &RecoveryStackV1,
    source_credential: &str,
    receipt: &router_ab_cloudflare::SigningWorkerPoolFreezeReceiptV1,
) -> Result<(), Box<dyn std::error::Error>> {
    use router_ab_cloudflare::{
        SigningWorkerEcdsaTransferRequestV1 as Command,
        SigningWorkerEcdsaTransferResponseV1 as Response,
    };
    let mut worker = destination.start_signing_worker()?;
    let entries = parse_local_env_file_contents_v1(&std::fs::read_to_string(
        destination
            .temp
            .join(router_ab_dev::LOCAL_SIGNING_WORKER_ENV_FILE_V1),
    )?)?;
    let LocalWorkerRoleConfigV1::SigningWorker(config) =
        parse_local_worker_role_config_for_role_v1(LocalServiceRoleV1::SigningWorker, entries)?
    else {
        return Err("expected destination SigningWorker configuration".into());
    };
    let credential = &config.router_to_signing_worker_ecdsa_auth;
    let preparation = Command::Prepare {
        scope: receipt.scope.clone(),
        request: router_ab_cloudflare::SigningWorkerRelocationIdentityV1 {
            move_id: receipt.request.move_id.clone(),
            source_generation: receipt.request.source_generation,
        },
        chunk_bytes: 1_024,
    };
    for unrelated in [
        "",
        TEST_ROLE_SHARED_SERVICE_AUTH,
        TEST_GATEWAY_TO_ROUTER_AUTH,
    ] {
        let (status, _) =
            transfer_ecdsa_http(&destination.signing_worker_url, unrelated, &preparation)?;
        assert_ne!(status, 200);
    }
    let (status, prepared_body) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &preparation)?;
    assert_eq!(status, 200, "{prepared_body}");
    assert!(matches!(
        serde_json::from_str::<Response>(&prepared_body)?,
        Response::Prepared { .. }
    ));
    let status_command = Command::Status {
        receipt: receipt.clone(),
        chunk_bytes: 1_024,
    };
    let (status, initial_progress) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &status_command)?;
    assert_eq!(status, 200, "{initial_progress}");
    assert_eq!(initial_progress, prepared_body);
    let activation = Command::Activate {
        receipt: receipt.clone(),
    };
    let (premature_activation, _) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &activation)?;
    assert_ne!(premature_activation, 200);
    let verify = Command::Verify {
        receipt: receipt.clone(),
    };
    let (premature, _) = transfer_ecdsa_http(&destination.signing_worker_url, credential, &verify)?;
    assert_ne!(premature, 200);
    let mut export = router_ab_cloudflare::SigningWorkerEcdsaExportRequestV1 {
        receipt: receipt.clone(),
        segment_index: 0,
        chunk_bytes: 1_024,
    };
    let (import, acknowledgement) = loop {
        let (status, body) = post_json_to_path_with_headers(
            &source.signing_worker_url,
            router_ab_cloudflare::SIGNING_WORKER_ECDSA_EXPORT_PATH_V1,
            &export,
            &[(
                LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
                source_credential,
            )],
        )?;
        assert_eq!(status, 200, "{body}");
        let chunk: router_ab_cloudflare::SigningWorkerEcdsaSnapshotChunkV1 =
            serde_json::from_str(&body)?;
        let count = chunk.segment_count;
        let import = Command::Import { chunk };
        let (status, acknowledgement) =
            transfer_ecdsa_http(&destination.signing_worker_url, credential, &import)?;
        assert_eq!(status, 200, "{acknowledgement}");
        assert!(matches!(
            serde_json::from_str::<Response>(&acknowledgement)?,
            Response::Imported { .. }
        ));
        if export.segment_index == 0 {
            drop(worker);
            worker = destination.start_signing_worker()?;
            let (status, progress) =
                transfer_ecdsa_http(&destination.signing_worker_url, credential, &status_command)?;
            assert_eq!(status, 200, "{progress}");
            assert_eq!(
                serde_json::from_str::<Response>(&progress)?,
                Response::Receiving {
                    receipt: receipt.clone(),
                    chunk_bytes: 1_024,
                    segment_count: count,
                    next_segment: 1,
                }
            );
            let mut changed = receipt.clone();
            changed.wallet_records_digest_hex = "f".repeat(64);
            let (status, _) = transfer_ecdsa_http(
                &destination.signing_worker_url,
                credential,
                &Command::Status {
                    receipt: changed,
                    chunk_bytes: 1_024,
                },
            )?;
            assert_ne!(status, 200);
            let (status, replay) =
                transfer_ecdsa_http(&destination.signing_worker_url, credential, &import)?;
            assert_eq!(status, 200, "{replay}");
            assert_eq!(replay, acknowledgement);
        }
        export.segment_index += 1;
        if export.segment_index == count {
            break (import, acknowledgement);
        }
    };
    drop(worker);
    let restarted = destination.start_signing_worker()?;
    let (status, replay) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &import)?;
    assert_eq!(status, 200, "{replay}");
    assert_eq!(replay, acknowledgement);
    let (status, verified_body) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &verify)?;
    assert_eq!(status, 200, "{verified_body}");
    assert_eq!(
        serde_json::from_str::<Response>(&verified_body)?,
        Response::Verified {
            receipt: receipt.clone()
        }
    );
    drop(restarted);
    let _verified = destination.start_signing_worker()?;
    let (status, replay) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &verify)?;
    assert_eq!(status, 200, "{replay}");
    assert_eq!(replay, verified_body);
    let (status, progress) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &status_command)?;
    assert_eq!(status, 200, "{progress}");
    assert_eq!(progress, verified_body);
    let (status, replay) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &preparation)?;
    assert_eq!(status, 200, "{replay}");
    assert_eq!(replay, prepared_body);
    let mut changed = receipt.clone();
    changed.request.source_generation += 1;
    let (status, _) = transfer_ecdsa_http(
        &destination.signing_worker_url,
        credential,
        &Command::Verify { receipt: changed },
    )?;
    assert_ne!(status, 200);
    let (unauthorized, _) = transfer_ecdsa_http(
        &destination.signing_worker_url,
        TEST_GATEWAY_TO_ROUTER_AUTH,
        &activation,
    )?;
    assert_ne!(unauthorized, 200);
    let (status, activated) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &activation)?;
    assert_eq!(status, 200, "{activated}");
    assert_eq!(
        serde_json::from_str::<Response>(&activated)?,
        Response::Activated {
            receipt: receipt.clone()
        }
    );
    drop(_verified);
    let _active = destination.start_signing_worker()?;
    let (status, replay) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &activation)?;
    assert_eq!(status, 200, "{replay}");
    assert_eq!(replay, activated);
    let (status, progress) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &status_command)?;
    assert_eq!(status, 200, "{progress}");
    assert_eq!(progress, activated);
    let Response::Activated {
        receipt: activation_receipt,
    } = serde_json::from_str::<Response>(&activated)?
    else {
        return Err("activation receipt required for cleanup".into());
    };
    let cleanup = Command::Cleanup {
        activation: activation_receipt,
    };
    let (unauthorized, _) = transfer_ecdsa_http(
        &source.signing_worker_url,
        TEST_GATEWAY_TO_ROUTER_AUTH,
        &cleanup,
    )?;
    assert_ne!(unauthorized, 200);
    let (wrong_home, _) =
        transfer_ecdsa_http(&destination.signing_worker_url, credential, &cleanup)?;
    assert_ne!(wrong_home, 200);
    let (status, cleaned) =
        transfer_ecdsa_http(&source.signing_worker_url, source_credential, &cleanup)?;
    assert_eq!(status, 200, "{cleaned}");
    assert_eq!(
        serde_json::from_str::<Response>(&cleaned)?,
        Response::Cleaned {
            receipt: receipt.clone()
        }
    );
    let (status, replay) =
        transfer_ecdsa_http(&source.signing_worker_url, source_credential, &cleanup)?;
    assert_eq!(status, 200, "{replay}");
    assert_eq!(replay, cleaned);
    Ok(())
}

// Only the outer export envelope is valid. Its ciphertext must never reach a Deriver.
fn reject_export_probe(
    router_url: &str,
    registration: &CloudflareRouterEd25519YaoExecuteRequestV2,
    generation: u64,
    expected_error: &str,
) -> Result<u16, Box<dyn std::error::Error>> {
    let mut request = serde_json::to_value(registration)?;
    let mut ceremony = request["target"]["binding"].clone();
    ceremony["operation"] = json!("export");
    ceremony["lifecycle"]["work_kind"] = json!("key_export");
    ceremony["lifecycle"]["primitive_request_kind"] = json!("export");
    request["target"]["operation"] = json!("export");
    request["target"]["ownership_generation"] = json!(generation);
    request["target"]["binding"] = json!({
        "ceremony": ceremony,
        "registered_public_key": vec![1u8; 32],
        "state_epoch": 1,
        "runtime_policy_binding": vec![2u8; 32],
        "authorization_digest": vec![3u8; 32],
    });
    request["target"]["deriver_a_input"]["kind"] = json!("export");
    request["target"]["deriver_b_input"]["kind"] = json!("export");
    request["target"]["deriver_a_input"]["operation"] = json!("export");
    request["target"]["deriver_b_input"]["operation"] = json!("export");
    let request: CloudflareRouterEd25519YaoExecuteRequestV2 = serde_json::from_value(request)?;
    let (status, body) = post_json_to_path_with_headers(
        router_url,
        LOCAL_ROUTER_ED25519_YAO_EXECUTE_PATH,
        &request,
        &[(
            LOCAL_ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
            TEST_GATEWAY_TO_ROUTER_AUTH,
        )],
    )?;
    assert_ne!(status, 200, "{body}");
    assert!(body.contains(expected_error), "{body}");
    Ok(status)
}
