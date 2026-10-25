use super::*;

pub(super) fn campaign(directory: &Path) -> serde_json::Value {
    let router_path = directory.join("retry-router.sqlite");
    let router = Db::open(&router_path);
    let policy = Policy::parse(r#"{"wallet_cooldown":{"mode":"enabled","interval_ms":60000},"max_active_operations":1,"max_active_preparations":2,"operation_timeout_ms":30000,"candidate_group_size":2,"preparation_group_size":4,"minimum_ready_batches":8,"refill_target_batches":16}"#).unwrap();
    let first_key = key("retry-first");
    let second_key = key("retry-second");
    let waiting_key = key("retry-waiting");
    for key in [&first_key, &second_key, &waiting_key] {
        activate(&router, key);
    }
    let failed = acquire(&router, &policy, &first_key, 1_000);
    let healthy = acquire(&router, &policy, &second_key, 1_001);
    assert_ne!(failed.producer_slot, healthy.producer_slot);
    assert!(matches!(
        tx(
            &router,
            m::refill::claim(
                &router,
                &policy,
                waiting_key.clone(),
                m::refill::Groups::Two,
                1_002
            )
        )
        .unwrap(),
        m::refill::Claim::Busy { .. }
    ));
    let wake = finish(&router, &policy, &failed, m::refill::Outcome::Failed, 1_100);
    assert_eq!(wake.first(), Some(&waiting_key));
    drop(router);
    let mut router = Db::open(&router_path);
    finish(&router, &policy, &failed, m::refill::Outcome::Failed, 1_200);
    assert_busy(&router, &policy, &waiting_key, 1_201, 3_100);
    finish(
        &router,
        &policy,
        &healthy,
        m::refill::Outcome::Published,
        1_300,
    );
    let waiting = acquire(&router, &policy, &waiting_key, 1_301);
    assert_eq!(waiting.producer_slot, healthy.producer_slot);
    assert_busy(&router, &policy, &first_key, 1_302, 3_100);
    finish(
        &router,
        &policy,
        &waiting,
        m::refill::Outcome::Published,
        1_400,
    );
    let replacement = acquire(&router, &policy, &first_key, 1_401);
    assert_eq!(replacement.producer_slot, healthy.producer_slot);
    assert_ne!(replacement.batch, failed.batch);
    // A stale success cannot clear the primary slot's durable failure history.
    finish(
        &router,
        &policy,
        &failed,
        m::refill::Outcome::Published,
        1_402,
    );
    finish(
        &router,
        &policy,
        &replacement,
        m::refill::Outcome::Published,
        1_500,
    );
    let healthy_again = acquire(&router, &policy, &second_key, 1_501);
    assert_eq!(healthy_again.producer_slot, healthy.producer_slot);
    assert_busy(&router, &policy, &waiting_key, 1_502, 3_100);
    finish(
        &router,
        &policy,
        &healthy_again,
        m::refill::Outcome::Published,
        1_700,
    );
    let primary_recovered = acquire(&router, &policy, &waiting_key, 3_100);
    assert_eq!(primary_recovered.producer_slot, failed.producer_slot);
    finish(
        &router,
        &policy,
        &primary_recovered,
        m::refill::Outcome::Published,
        3_101,
    );

    let role_a_path = directory.join("retry-a.sqlite");
    let role_b_path = directory.join("retry-b.sqlite");
    let role_a = Db::open(&role_a_path);
    let role_b = Db::open(&role_b_path);
    tx(&role_a, pool::install_key(&role_a, first_key.clone())).unwrap();
    tx(&role_b, pool::install_key(&role_b, first_key.clone())).unwrap();
    let serial = Policy::default();
    let mut now = 4_000;
    let mut attempts = Vec::new();
    let mut ids = std::collections::BTreeSet::new();
    for (outcome, delay) in [
        (m::refill::Outcome::Failed, 2_000),
        (m::refill::Outcome::Failed, 4_000),
        (m::refill::Outcome::Interrupted, 8_000),
        (m::refill::Outcome::Failed, 16_000),
        (m::refill::Outcome::Failed, 30_000),
        (m::refill::Outcome::Failed, 30_000),
    ] {
        let job = acquire(&router, &serial, &first_key, now);
        for id in job.batch_ids() {
            assert!(ids.insert(id));
        }
        tx(&role_a, m::refill::start_role(&role_a, &job, now)).unwrap();
        tx(&role_b, m::refill::start_role(&role_b, &job, now)).unwrap();
        let failed_at = now + 1;
        finish(&router, &serial, &job, outcome, failed_at);
        let retry_at = failed_at + delay;
        assert_busy(&router, &serial, &first_key, failed_at + 1, retry_at);
        finish(&router, &serial, &job, outcome, failed_at + 2);
        drop(router);
        router = Db::open(&router_path);
        assert_busy(&router, &serial, &first_key, failed_at + 3, retry_at);
        if delay == 30_000 {
            assert_busy(
                &router,
                &serial,
                &second_key,
                failed_at + 4,
                failed_at + 5_004,
            );
            // No head renewal near the deadline. A newcomer still cannot jump it.
            assert_busy(
                &router,
                &serial,
                &waiting_key,
                retry_at + 10,
                retry_at + 5_010,
            );
            tx(&router, m::refill::withdraw(&router, &second_key)).unwrap();
            tx(&router, m::refill::withdraw(&router, &waiting_key)).unwrap();
        }
        assert!(!tx(&router, m::refill::check(&router, &job, retry_at)).unwrap());
        assert!(tx(&role_a, m::refill::start_role(&role_a, &job, retry_at)).is_err());
        assert!(tx(&role_b, m::refill::start_role(&role_b, &job, retry_at)).is_err());
        attempts.push(serde_json::json!({"job":job,"outcome":outcome,"failed_at_ms":failed_at,"retry_at_ms":retry_at,"delay_ms":delay}));
        now = retry_at + 11;
    }
    let succeeded = acquire(&router, &serial, &first_key, now);
    finish(
        &router,
        &serial,
        &succeeded,
        m::refill::Outcome::Published,
        now + 1,
    );
    let timed_out = acquire(&router, &serial, &first_key, now + 2);
    let expired_at = timed_out.expires_at_ms;
    assert_busy(&router, &serial, &first_key, expired_at, expired_at + 2_000);
    // A late success and repeated claims cannot erase or extend the expiry delay.
    finish(
        &router,
        &serial,
        &timed_out,
        m::refill::Outcome::Published,
        expired_at + 1,
    );
    assert_busy(
        &router,
        &serial,
        &first_key,
        expired_at + 2,
        expired_at + 2_000,
    );
    drop(router);
    let router = Db::open(&router_path);
    let after_expiry = acquire(&router, &serial, &first_key, expired_at + 2_000);
    assert_ne!(after_expiry.batch, timed_out.batch);
    assert_ne!(after_expiry.batch, succeeded.batch);
    finish(
        &router,
        &serial,
        &after_expiry,
        m::refill::Outcome::Published,
        expired_at + 2_001,
    );
    serde_json::json!({
        "scope":"Transactional admission and separate participant start markers; no cryptographic preparation or hosted latency claim.",
        "attempts":attempts,"fresh_failed_pair_ids":ids.len(),
        "healthy_secondary_serves_fifo_demand":true,"restart_preserves_deadline":true,
        "queue_head_survives_full_pause_without_renewal":true,
        "duplicate_finish_preserves_deadline":true,"stale_success_cannot_clear_backoff":true,
        "successful_publication_resets_delay":true,"expired_lease_delayed_once":true,
        "role_start_markers_remain_single_use":true,"per_wallet_target_candidates":32,
    })
}

fn acquire(db: &Db, policy: &Policy, key: &KeyScope, now: u64) -> m::refill::Job {
    match tx(
        db,
        m::refill::claim(db, policy, key.clone(), m::refill::Groups::Two, now),
    )
    .unwrap()
    {
        m::refill::Claim::Acquired { job } => job,
        other => panic!("Expected a producer grant, got {other:?}"),
    }
}

fn assert_busy(db: &Db, policy: &Policy, key: &KeyScope, now: u64, expected_retry: u64) {
    match tx(
        db,
        m::refill::claim(db, policy, key.clone(), m::refill::Groups::Two, now),
    )
    .unwrap()
    {
        m::refill::Claim::Busy { retry_at_ms } => assert_eq!(retry_at_ms, expected_retry),
        other => panic!("Expected a delayed producer grant, got {other:?}"),
    }
}

fn finish(
    db: &Db,
    policy: &Policy,
    job: &m::refill::Job,
    outcome: m::refill::Outcome,
    now: u64,
) -> Vec<KeyScope> {
    tx(db, m::refill::finish(db, policy, job, outcome, now)).unwrap()
}
