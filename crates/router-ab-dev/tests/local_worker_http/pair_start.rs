use super::*;

const PREPARE_B: &str = router_ab_dev::LOCAL_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH;

/// One wallet's registration against a fresh root, with what the tests read
/// back from the role stores.
struct PairStartV1 {
    stack: RecoveryStackV1,
    _signing_worker: ChildGuard,
    registration: CloudflareRouterEd25519YaoExecuteRequestV2,
    lineage_b64u: String,
}

impl PairStartV1 {
    fn start(label: &str, router_env: &[(&str, &str)]) -> Result<Self, Box<dyn std::error::Error>> {
        let stack = RecoveryStackV1::start_with_router_env(label, router_env)?;
        let signing_worker = stack.start_signing_worker()?;
        let (identity, lineage, lineage_b64u) = recovery_ceremony(label)?;
        let grant = product_creation_grant_b64u(&stack.temp, &identity, lineage, None)?;
        let (status, body) = stack.create(&grant)?;
        assert_eq!(status, 200, "{body}");
        let (registration, _) =
            stack.wallet_registration(&identity, &lineage_b64u, "account-pair-start")?;
        Ok(Self {
            stack,
            _signing_worker: signing_worker,
            registration,
            lineage_b64u,
        })
    }

    /// The Router's answer to the registration, and how long it took.
    fn register(&self) -> Result<(serde_json::Value, Duration), Box<dyn std::error::Error>> {
        let started = Instant::now();
        let (status, body) = self.stack.register(&self.registration)?;
        assert_eq!(status, 200, "{body}");
        Ok((serde_json::from_str(&body)?, started.elapsed()))
    }

    /// The exact registration again, once the Router's claim on it has lapsed.
    fn retry(&self) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let (answer, _) = self.register()?;
            if answer["code"] != "execution_in_progress" {
                return Ok(answer);
            }
            if Instant::now() > deadline {
                return Err("the Router's claim on the registration never lapsed".into());
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    fn pair_states(&self, role: &str) -> rusqlite::Result<Vec<String>> {
        let (db, table) = match role {
            "deriver_a" => (&self.stack.a_store, "local_deriver_a_yao_pairs"),
            _ => (&self.stack.b_store, "local_deriver_b_yao_pairs"),
        };
        db.prepare(&format!(
            "SELECT json_extract(record_json, '$.status') FROM {table} ORDER BY session_hex"
        ))?
        .query_map([], |row| row.get(0))?
        .collect()
    }

    fn admissions(&self, role: &str) -> rusqlite::Result<Vec<String>> {
        let db = if role == "deriver_a" {
            &self.stack.a_store
        } else {
            &self.stack.b_store
        };
        db.prepare(
            "SELECT status FROM tenant_root_root_use_admissions
             WHERE custody_lineage_b64u = ?1 ORDER BY admitted_at_ms",
        )?
        .query_map([&self.lineage_b64u], |row| row.get(0))?
        .collect()
    }

    fn assert_completed(&self) -> Result<(), Box<dyn std::error::Error>> {
        assert_eq!(self.pair_states("deriver_a")?, vec!["completed"]);
        assert_eq!(self.pair_states("deriver_b")?, vec!["completed"]);
        assert_eq!(self.admissions("deriver_a")?, vec!["settled"]);
        assert_eq!(self.admissions("deriver_b")?, vec!["settled"]);
        Ok(())
    }
}

fn wait_for(what: &str, ready: &dyn Fn() -> bool) -> Result<(), Box<dyn std::error::Error>> {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !ready() {
        if Instant::now() > deadline {
            return Err(format!("timed out waiting for {what}").into());
        }
        thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}

/// The Router sends Deriver B its preparation and Deriver A its execution at
/// the same time. Deriver A's connection can reach Deriver B first: B holds
/// it until its own preparation lands, then claims the pair, and the
/// registration completes.
#[test]
fn vm_pair_completes_when_deriver_a_connects_before_deriver_b_is_prepared(
) -> Result<(), Box<dyn std::error::Error>> {
    let _process_guard = local_worker_process_test_guard();
    let pair = PairStartV1::start("pair-socket-before-preparation", &[])?;
    pair.stack.proxy_b.hold_next_request_on(PREPARE_B);
    let registering = {
        let router_url = pair.stack.router_url.clone();
        let registration = pair.registration.clone();
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
    wait_for("Deriver B's preparation to be held", &|| {
        pair.stack.proxy_b.held_request().is_some()
    })?;
    // Deriver A reserved its pair and connected. Deriver B holds nothing for
    // the session yet, so it keeps the connection waiting.
    wait_for("Deriver A's reservation", &|| {
        pair.pair_states("deriver_a")
            .is_ok_and(|states| states == vec!["starting"])
    })?;
    thread::sleep(Duration::from_millis(300));
    assert_eq!(pair.pair_states("deriver_a")?, vec!["starting"]);
    assert!(
        pair.pair_states("deriver_b")?.is_empty(),
        "B is not prepared"
    );
    assert!(
        pair.admissions("deriver_b")?.is_empty(),
        "B admitted nothing yet"
    );

    pair.stack.proxy_b.release_request();
    let (status, body) = registering
        .join()
        .map_err(|_| "the registration thread panicked")??;
    assert_eq!(status, 200, "{body}");
    assert!(registration_succeeded(&body)?, "{body}");
    pair.assert_completed()?;

    println!(
        "VM_PAIR_SOCKET_BEFORE_PREPARATION_E2E {}",
        json!({
            "while_preparation_held": { "deriver_a": "starting", "deriver_b": "no record" },
            "registration": "succeeded",
            "pairs_after": { "deriver_a": "completed", "deriver_b": "completed" },
        })
    );
    Ok(())
}

/// Deriver B's preparation never arrives. B refuses Deriver A's connection
/// when the Router's run ends, saying it holds no claim. A releases its
/// reservation, nothing burns, and the exact registration, retried once the
/// Router's claim has lapsed, completes.
#[test]
fn vm_pair_whose_preparation_is_lost_is_released_and_an_exact_retry_completes(
) -> Result<(), Box<dyn std::error::Error>> {
    const LEASE_MS: u64 = 2_000;
    let _process_guard = local_worker_process_test_guard();
    let pair = PairStartV1::start(
        "pair-preparation-lost",
        &[("ROUTER_YAO_REGISTRATION_LEASE_MS", "2000")],
    )?;
    pair.stack.proxy_b.drop_next_on(PREPARE_B);
    let (first, elapsed) = pair.register()?;
    assert!(
        pair.stack.proxy_b.dropped_on(),
        "B's preparation was dropped"
    );
    assert_eq!(first["status"], "recoverable_failure", "{first}");
    assert_eq!(first["code"], "service_unavailable", "{first}");
    assert!(
        elapsed >= Duration::from_millis(LEASE_MS - 500),
        "B waited for its preparation until the run ended: {elapsed:?}"
    );
    assert_eq!(
        pair.pair_states("deriver_a")?,
        vec!["prepared"],
        "A released its reservation"
    );
    assert!(
        pair.pair_states("deriver_b")?.is_empty(),
        "B holds no record"
    );
    assert_eq!(pair.admissions("deriver_a")?, vec!["admitted"]);
    assert!(pair.admissions("deriver_b")?.is_empty());

    let retried = pair.retry()?;
    assert_eq!(retried["status"], "succeeded", "{retried}");
    pair.assert_completed()?;

    println!(
        "VM_PAIR_PREPARATION_LOST_E2E {}",
        json!({
            "first_run": [first["status"], first["code"]],
            "first_run_ms": elapsed.as_millis(),
            "after_first_run": { "deriver_a": "prepared", "deriver_b": "no record" },
            "exact_retry": retried["status"],
            "pairs_after": { "deriver_a": "completed", "deriver_b": "completed" },
        })
    );
    Ok(())
}

/// Deriver B's preparation fails on a store error. B refuses Deriver A's
/// connection as soon as it has failed, not when the Router's run ends. A
/// releases its reservation, and the exact registration, retried once B's
/// store answers again, completes.
#[test]
fn vm_pair_whose_preparation_fails_is_released_before_the_run_ends(
) -> Result<(), Box<dyn std::error::Error>> {
    const LEASE_MS: u64 = 5_000;
    let _process_guard = local_worker_process_test_guard();
    let pair = PairStartV1::start(
        "pair-preparation-fails",
        &[("ROUTER_YAO_REGISTRATION_LEASE_MS", "5000")],
    )?;
    // B's admission table is out of reach for the first run.
    pair.stack.b_store.execute_batch(
        "ALTER TABLE tenant_root_root_use_admissions RENAME TO tenant_root_root_use_admissions_held",
    )?;
    let first = pair.register();
    pair.stack.b_store.execute_batch(
        "ALTER TABLE tenant_root_root_use_admissions_held RENAME TO tenant_root_root_use_admissions",
    )?;
    let (first, elapsed) = first?;
    assert_eq!(first["status"], "recoverable_failure", "{first}");
    assert!(
        elapsed < Duration::from_millis(LEASE_MS - 2_000),
        "B refused once its preparation failed: {elapsed:?}"
    );
    assert_eq!(
        pair.pair_states("deriver_a")?,
        vec!["prepared"],
        "A released its reservation"
    );
    assert!(
        pair.pair_states("deriver_b")?.is_empty(),
        "B holds no record"
    );
    assert!(
        pair.admissions("deriver_b")?.is_empty(),
        "a failed preparation admits nothing"
    );

    let retried = pair.retry()?;
    assert_eq!(retried["status"], "succeeded", "{retried}");
    pair.assert_completed()?;

    println!(
        "VM_PAIR_PREPARATION_FAILS_E2E {}",
        json!({
            "first_run": [first["status"], first["code"]],
            "first_run_ms": elapsed.as_millis(),
            "after_first_run": { "deriver_a": "prepared", "deriver_b": "no record" },
            "exact_retry": retried["status"],
            "pairs_after": { "deriver_a": "completed", "deriver_b": "completed" },
        })
    );
    Ok(())
}
