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
        .hold_next_request_on(router_ab_dev::LOCAL_DERIVER_A_ED25519_YAO_PREPARE_PAIR_PATH);
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
    let owner = router_ab_cloudflare::RouterWalletRegistrationV1::from_request(&registration)?
        .ok_or("registration owner")?
        .owner;
    let freeze = router_ab_cloudflare::RouterWalletFreezeRequestV1 {
        owner,
        move_id: format!("wmove_{}", "a".repeat(43)),
        request_digest_hex: "b".repeat(64),
        source_generation: 1,
        destination_generation: 2,
    };
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
    let sealed = freeze_wallet(&stack.router_url, &freeze)?;
    assert_eq!(sealed["state"], "frozen", "{sealed}");
    assert_eq!(sealed["receipt"]["record_count"], 1);
    assert_eq!(freeze_wallet(&stack.router_url, &freeze)?, sealed);
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
    drop(signing_worker);
    println!(
        "R150_VM_ROUTER_WALLET_OBJECT_E2E {}",
        json!({
            "retry_while_claimed": [in_progress["code"], retry_after_ms],
            "first_run": "succeeded",
            "exact_retry": "recorded answer, byte for byte, no new pair",
            "same_lifecycle_other_lineage": "execution_mismatch",
            "consume": {
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
            },
        })
    );
    Ok(())
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
/// 2. Its one-second lease lapses, and an exact retry takes the claim over as
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

    // 2. The lease lapses. An exact retry takes the claim over and is paused
    //    reading Deriver B's pair status.
    thread::sleep(Duration::from_millis(LEASE_MS + 250).saturating_sub(first_claimed_at.elapsed()));
    stack
        .proxy_b
        .hold_next_request_on(router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_READ_PAIR_STATUS_PATH);
    let takeover = run();
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
    let (takeover_status, takeover_body) =
        takeover.join().map_err(|_| "the takeover run panicked")??;
    assert_eq!(takeover_status, 200, "{takeover_body}");
    assert!(registration_succeeded(&takeover_body)?, "{takeover_body}");
    let recorded = router_record()?;
    assert_eq!(recorded["kind"], "completed", "{recorded}");
    assert_eq!(
        recorded["response_json"],
        json!(takeover_body),
        "the takeover run's answer"
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
            "takeover_run": "succeeded and recorded its answer",
            "exact_retry": "the takeover run's answer, byte for byte, no new pair",
        })
    );
    Ok(())
}
