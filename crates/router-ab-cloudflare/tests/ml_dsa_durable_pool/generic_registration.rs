//! Restarted generic preparation uses fresh material and preserves completed work.
use super::*;
use m::registration::{self, queue, PreparationAllocation};

pub(super) fn run(directory: &Path) -> serde_json::Value {
    let path = directory.join("generic-registration.sqlite");
    let db = Db::open(&path);
    let input = registration_request("cold-registration", 61);
    let group = Default::default();
    let configuration = queue::Configuration::new([7; 32], [8; 32], 4).unwrap();
    for _ in 0..3 {
        assert!(matches!(
            tx(
                &db,
                queue::request(&db, input.wallet.clone(), group, configuration.clone(), 100)
            )
            .unwrap(),
            queue::Status::Pending { .. }
        ));
    }
    let interrupted = match tx(&db, queue::next(&db, &configuration, 101)).unwrap() {
        queue::Work::Prepare { job } => job,
        _ => panic!("Cold demand did not allocate preparation"),
    };
    assert!(matches!(
        tx(
            &db,
            registration::prepare(
                &db,
                registration::scope(&input.wallet).unwrap(),
                group,
                [7; 32],
                [8; 32],
                4,
                102
            )
        )
        .unwrap(),
        PreparationAllocation::Waiting { .. }
    ));
    tx(
        &db,
        registration::ready(&db, &interrupted, Participant::A, 103),
    )
    .unwrap();
    drop(db);
    let db = Db::open(&path);
    let retry_at = match tx(&db, queue::next(&db, &configuration, 200)).unwrap() {
        queue::Work::Wait { retry_at_ms } => retry_at_ms,
        _ => panic!("Interrupted work was reused"),
    };
    assert_eq!(retry_at, 2_200);
    assert!(!tx(&db, registration::check_job(&db, &interrupted, 201)).unwrap());
    assert!(tx(
        &db,
        registration::ready(&db, &interrupted, Participant::B, 201)
    )
    .is_err());
    let replacement = match tx(&db, queue::next(&db, &configuration, retry_at)).unwrap() {
        queue::Work::Prepare { job } => job,
        _ => panic!("Fresh preparation was not dispatched"),
    };
    assert_ne!(replacement.id, interrupted.id);
    for role in [Participant::A, Participant::B] {
        tx(
            &db,
            registration::ready(&db, &replacement, role, retry_at + 1),
        )
        .unwrap();
    }
    let claim = match tx(
        &db,
        registration::claim(&db, input.clone(), [7; 32], [8; 32], 4, retry_at + 2),
    )
    .unwrap()
    {
        registration::Decision::Admitted { claim } => claim,
        _ => panic!("Prepared work could not be claimed"),
    };
    // The claim can arrive before the producer receives its final acknowledgement.
    tx(&db, queue::replenish(&db, &claim, retry_at + 3)).unwrap();
    tx(&db, queue::finish(&db, &replacement, retry_at + 4)).unwrap();
    assert!(tx(&db, registration::check_claim(&db, &claim, retry_at + 5)).unwrap());
    assert!(matches!(
        tx(&db, queue::next(&db, &configuration, retry_at + 5)).unwrap(),
        queue::Work::Wait { .. }
    ));
    drop(db);
    let db = Db::open(&path);
    let cached = match tx(&db, queue::next(&db, &configuration, claim.deadline + 1)).unwrap() {
        queue::Work::Prepare { job } => job,
        _ => panic!("Replacement demand was lost after the claim race"),
    };
    assert_ne!(cached.id, replacement.id);
    for role in [Participant::A, Participant::B] {
        tx(
            &db,
            registration::ready(&db, &cached, role, claim.deadline + 2),
        )
        .unwrap();
    }
    // Durable Ready reconciles a lost producer reply after restart.
    drop(db);
    let db = Db::open(&path);
    assert!(matches!(
        tx(&db, queue::next(&db, &configuration, claim.deadline + 3)).unwrap(),
        queue::Work::Idle
    ));
    match tx(
        &db,
        queue::request(&db, input.wallet, group, configuration, claim.deadline + 4),
    )
    .unwrap()
    {
        queue::Status::Ready { job } => assert_eq!(job, cached),
        _ => panic!("Durable prepared work was discarded after a lost reply"),
    }
    fairness_and_expiry(directory);
    expired_peer_after_clock_correction(directory);
    serde_json::json!({
        "failed_scope_does_not_starve_peers": true,
        "retry_backoff_survives_rotation": true,
        "abandoned_demand_expires": true,
        "expired_peer_cannot_force_alarm_hot_loop": true,
        "cold_demand_deduplicated": true,
        "one_preparing_job": true,
        "restart_retires_partial_work": true,
        "late_ready_refused": true,
        "fresh_job_after_interruption": true,
        "claimed_job_preserved": true,
        "replacement_demand_survives_claim_race": true,
        "online_claim_has_priority": true,
        "lost_ready_reply_reconciled": true,
    })
}

fn fairness_and_expiry(directory: &Path) {
    let path = directory.join("generic-preparation-fairness.sqlite");
    let db = Db::open(&path);
    let bad = registration_request("failing-scope", 71).wallet;
    let mut healthy = registration_request("healthy-scope", 72).wallet;
    healthy.project = id("another-project");
    let configuration = queue::Configuration::new([7; 32], [8; 32], 4).unwrap();
    for wallet in [&bad, &healthy] {
        tx(
            &db,
            queue::request(
                &db,
                wallet.clone(),
                Default::default(),
                configuration.clone(),
                100,
            ),
        )
        .unwrap();
    }
    let failed = match tx(&db, queue::next(&db, &configuration, 101)).unwrap() {
        queue::Work::Prepare { job } => job,
        _ => panic!("The first scope did not start"),
    };
    drop(db);
    let db = Db::open(&path);
    assert!(matches!(
        tx(&db, queue::next(&db, &configuration, 102)).unwrap(),
        queue::Work::Wait { .. }
    ));
    let good = match tx(&db, queue::next(&db, &configuration, 103)).unwrap() {
        queue::Work::Prepare { job } => job,
        _ => panic!("Failed preparation starved the healthy scope"),
    };
    assert_eq!(good.scope, registration::scope(&healthy).unwrap());
    for role in [Participant::A, Participant::B] {
        tx(&db, registration::ready(&db, &good, role, 104)).unwrap();
    }
    tx(&db, queue::finish(&db, &good, 105)).unwrap();
    assert!(matches!(
        tx(&db, queue::next(&db, &configuration, 106)).unwrap(),
        queue::Work::Wait { retry_at_ms: 2_102 }
    ));
    let retried = match tx(&db, queue::next(&db, &configuration, 2_102)).unwrap() {
        queue::Work::Prepare { job } => job,
        _ => panic!("The failed scope lost its bounded retry"),
    };
    assert_ne!(retried.id, failed.id);
    drop(db);
    let db = Db::open(&path);
    assert!(matches!(
        tx(&db, queue::next(&db, &configuration, 900_101)).unwrap(),
        queue::Work::Idle
    ));
    assert!(!tx(&db, registration::check_job(&db, &retried, 900_101)).unwrap());
}

fn expired_peer_after_clock_correction(directory: &Path) {
    let path = directory.join("generic-preparation-clock.sqlite");
    let db = Db::open(&path);
    let head = registration_request("backed-off-head", 81).wallet;
    let mut peer = registration_request("expired-peer", 82).wallet;
    peer.project = id("clock-peer-project");
    let configuration = queue::Configuration::new([7; 32], [8; 32], 4).unwrap();
    tx(
        &db,
        queue::request(&db, head, Default::default(), configuration.clone(), 1_000),
    )
    .unwrap();
    let mut now = 1_001;
    for delay in [2_000, 4_000, 8_000, 16_000, 30_000] {
        if delay == 30_000 {
            now = 900_000;
        }
        let job = match tx(&db, queue::next(&db, &configuration, now)).unwrap() {
            queue::Work::Prepare { job } => job,
            _ => panic!("Backoff fixture could not start its next attempt"),
        };
        tx(&db, queue::finish(&db, &job, now + 1)).unwrap();
        now += 1 + delay;
    }
    // Exercise persisted timestamps across a clock discontinuity and restart.
    tx(
        &db,
        queue::request(&db, peer, Default::default(), configuration.clone(), 100),
    )
    .unwrap();
    drop(db);
    let db = Db::open(&path);
    assert!(matches!(
        tx(&db, queue::next(&db, &configuration, 900_101)).unwrap(),
        queue::Work::Wait {
            retry_at_ms: 930_001
        }
    ));
    assert!(matches!(
        tx(&db, queue::next(&db, &configuration, 900_102)).unwrap(),
        queue::Work::Wait {
            retry_at_ms: 930_001
        }
    ));
}
