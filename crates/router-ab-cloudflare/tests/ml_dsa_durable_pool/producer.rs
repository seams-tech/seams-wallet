//! Admission leases and producer restarts share durable identities across reply loss.
use super::*;
use m::producer::{self, Terminal, Work};

pub(super) fn campaign(directory: &Path) -> serde_json::Value {
    let router_path = directory.join("producer-router.sqlite");
    let producer_path = directory.join("producer.sqlite");
    let mut router = Db::open(&router_path);
    let mut producer = Db::open(&producer_path);
    let policy = Policy::default();
    let key = key("producer-restart");
    activate(&router, &key);
    let first = acquire(&router, &policy, &key, 1_000);
    tx(
        &producer,
        producer::enqueue(&producer, first.clone(), 1_001),
    )
    .unwrap();
    tx(
        &producer,
        producer::enqueue(&producer, first.clone(), 1_002),
    )
    .unwrap();
    assert_eq!(pending(&producer), vec![first.batch]);
    let mut changed = first.clone();
    changed.material_expires_at_ms += 1;
    assert!(tx(&producer, producer::enqueue(&producer, changed, 1_003)).is_err());
    assert!(matches!(
        tx(&producer, producer::next_work(&producer)).unwrap(),
        Work::Run(job) if job == first
    ));
    drop(producer);
    producer = Db::open(&producer_path);
    assert!(matches!(
        tx(&producer, producer::next_work(&producer)).unwrap(),
        Work::Abandon(job) if job == first
    ));
    // The host confirms both publications after a lost transport acknowledgement.
    let terminal = Terminal::Published { job: first.clone() };
    tx(
        &producer,
        producer.put(&producer::record_key(first.batch), &terminal),
    )
    .unwrap();
    let publication: serde_json::Value =
        tx(&producer, producer.get(&producer::record_key(first.batch)))
            .unwrap()
            .unwrap();
    assert_eq!(publication["state"], "published");
    assert_eq!(publication["job"], serde_json::to_value(&first).unwrap());
    tx(
        &router,
        m::refill::finish(&router, &policy, &first, terminal.outcome(), 1_010),
    )
    .unwrap();
    // Lose settlement's reply after the Router commits, then acquire the next lease.
    drop(router);
    router = Db::open(&router_path);
    let second = acquire(&router, &policy, &key, 1_011);
    assert_ne!(second.batch, first.batch);
    tx(
        &producer,
        producer::enqueue(&producer, second.clone(), 1_012),
    )
    .unwrap();
    drop(producer);
    producer = Db::open(&producer_path);
    let Work::Settle(replayed) = tx(&producer, producer::next_work(&producer)).unwrap() else {
        panic!("A committed publication restarted preparation");
    };
    assert_eq!(replayed.job(), &first);
    assert!(matches!(replayed.outcome(), m::refill::Outcome::Published));
    tx(
        &router,
        m::refill::finish(&router, &policy, replayed.job(), replayed.outcome(), 1_013),
    )
    .unwrap();
    assert!(tx(&router, m::refill::check(&router, &second, 1_013)).unwrap());
    assert!(tx(&producer, producer::remove_head(&producer, second.batch)).is_err());
    assert_eq!(pending(&producer), vec![first.batch, second.batch]);
    tx(&producer, producer::remove_head(&producer, first.batch)).unwrap();
    assert!(matches!(
        tx(&producer, producer::next_work(&producer)).unwrap(),
        Work::Run(job) if job == second
    ));
    // Duplicate old delivery cannot append the settled record before its lease expires.
    tx(
        &producer,
        producer::enqueue(&producer, first.clone(), 1_014),
    )
    .unwrap();
    assert_eq!(pending(&producer), vec![second.batch]);
    // A running job survives restart as recovery work and never runs a second time.
    drop(producer);
    producer = Db::open(&producer_path);
    let Work::Abandon(interrupted) = tx(&producer, producer::next_work(&producer)).unwrap() else {
        panic!("A running job resumed cryptographic preparation");
    };
    assert_eq!(interrupted, second);
    let terminal = Terminal::Interrupted { job: interrupted };
    tx(
        &producer,
        producer.put(&producer::record_key(second.batch), &terminal),
    )
    .unwrap();
    tx(
        &router,
        m::refill::finish(
            &router,
            &policy,
            terminal.job(),
            terminal.outcome(),
            second.expires_at_ms,
        ),
    )
    .unwrap();
    tx(&producer, producer::remove_head(&producer, second.batch)).unwrap();
    assert!(pending(&producer).is_empty());
    assert!(matches!(
        tx(&producer, producer::next_work(&producer)).unwrap(),
        Work::Idle
    ));
    assert!(tx(
        &producer,
        producer::enqueue(&producer, second.clone(), second.expires_at_ms,)
    )
    .is_err());
    serde_json::json!({
        "scope": "SQLite admission and producer restart lifecycle. Publication is confirmed by a host fixture. Worker E2Es cover actual preparation and paired publication.",
        "publication_record": publication,
        "next_job": second,
        "running_restarts_as_recovery": true,
        "terminal_restarts_as_settlement": true,
        "duplicate_delivery_cannot_requeue_settled_job": true,
        "stale_settlement_preserves_new_lease": true,
        "out_of_order_removal_rejected": true,
        "final_pending": pending(&producer),
    })
}

fn acquire(db: &Db, policy: &Policy, key: &KeyScope, now: u64) -> m::refill::Job {
    match tx(
        db,
        m::refill::claim(db, policy, key.clone(), observed_stock(1), now),
    )
    .unwrap()
    {
        m::refill::Claim::Acquired { job } => job,
        other => panic!("Expected producer lease: {other:?}"),
    }
}
fn pending(db: &Db) -> Vec<[u8; 32]> {
    tx(db, db.get(producer::PENDING))
        .unwrap()
        .unwrap_or_default()
}
