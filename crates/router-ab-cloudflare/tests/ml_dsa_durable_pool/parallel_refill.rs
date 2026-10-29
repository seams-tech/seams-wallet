use super::*;

pub(super) fn campaign(directory: &Path) -> serde_json::Value {
    let path = directory.join("parallel-refill.sqlite");
    let router = Db::open(&path);
    let policy = Policy::parse(r#"{"wallet_cooldown":{"mode":"enabled","interval_ms":60000},"max_active_operations":1,"max_active_preparations":2,"operation_timeout_ms":30000,"candidate_group_size":2,"preparation_group_size":4,"minimum_ready_batches":8,"refill_target_batches":16}"#).unwrap();
    let a = key("parallel-a");
    let b = key("parallel-b");
    let c = key("parallel-c");
    for key in [&a, &b, &c] {
        activate(&router, key);
    }
    let m::refill::Claim::Acquired { job: first } = tx(
        &router,
        m::refill::claim(&router, &policy, a.clone(), observed_stock(2), 1_000),
    )
    .unwrap() else {
        panic!("Missing first slot")
    };
    let m::refill::Claim::Acquired { job: second } = tx(
        &router,
        m::refill::claim(&router, &policy, b.clone(), observed_stock(2), 1_001),
    )
    .unwrap() else {
        panic!("Missing second slot")
    };
    assert_ne!(first.producer_slot, second.producer_slot);
    assert_ne!(
        first.producer_slot.namespace(),
        second.producer_slot.namespace()
    );
    assert!(tx(&router, m::refill::check(&router, &first, 1_002)).unwrap());
    assert!(tx(&router, m::refill::check(&router, &second, 1_002)).unwrap());
    assert!(matches!(
        tx(
            &router,
            m::refill::claim(&router, &policy, a.clone(), observed_stock(2), 1_002)
        )
        .unwrap(),
        m::refill::Claim::Busy { .. }
    ));
    assert!(matches!(
        tx(
            &router,
            m::refill::claim(&router, &policy, c.clone(), observed_stock(2), 1_003)
        )
        .unwrap(),
        m::refill::Claim::Busy { .. }
    ));
    // Restart preserves both leases. A one-slot policy cannot overbook the other slot.
    drop(router);
    let router = Db::open(&path);
    let wake = tx(
        &router,
        m::refill::finish(
            &router,
            &policy,
            &first,
            m::refill::Outcome::Published,
            1_004,
        ),
    )
    .unwrap();
    assert_eq!(wake.first(), Some(&c));
    assert!(tx(&router, m::refill::check(&router, &second, 1_004)).unwrap());
    assert!(matches!(
        tx(
            &router,
            m::refill::claim(
                &router,
                &Policy::default(),
                c.clone(),
                observed_stock(2),
                1_005
            )
        )
        .unwrap(),
        m::refill::Claim::Busy { .. }
    ));
    let m::refill::Claim::Acquired { job: replacement } = tx(
        &router,
        m::refill::claim(&router, &policy, c.clone(), observed_stock(2), 1_006),
    )
    .unwrap() else {
        panic!("Missing reused slot")
    };
    assert_eq!(replacement.producer_slot, first.producer_slot);
    assert!(tx(
        &router,
        m::refill::finish(
            &router,
            &policy,
            &first,
            m::refill::Outcome::Published,
            1_007
        )
    )
    .unwrap()
    .is_empty());
    assert!(tx(&router, m::refill::check(&router, &replacement, 1_007)).unwrap());
    let mut changed = second.clone();
    changed.producer_slot = first.producer_slot;
    assert!(!tx(&router, m::refill::check(&router, &changed, 1_007)).unwrap());
    assert!(tx(
        &router,
        m::refill::finish(
            &router,
            &policy,
            &changed,
            m::refill::Outcome::Published,
            1_007
        )
    )
    .unwrap()
    .is_empty());
    let mut recovered = b.clone();
    recovered.epoch += 1;
    activate(&router, &recovered);
    assert!(!tx(&router, m::refill::check(&router, &second, 1_008)).unwrap());
    assert!(tx(&router, m::refill::check(&router, &replacement, 1_008)).unwrap());
    tx(
        &router,
        m::refill::finish(
            &router,
            &policy,
            &second,
            m::refill::Outcome::Published,
            1_009,
        ),
    )
    .unwrap();
    assert!(tx(&router, m::refill::check(&router, &replacement, 1_009)).unwrap());
    // Decode the existing primary storage format at its persistence boundary.
    let mut stored = serde_json::to_value(&replacement).unwrap();
    stored.as_object_mut().unwrap().remove("producer_slot");
    tx(&router, router.put("preprocessing-active", &stored)).unwrap();
    assert!(tx(&router, m::refill::check(&router, &replacement, 1_010)).unwrap());
    let borrowing = borrowing_campaign(directory);
    serde_json::json!({"borrowing":borrowing,"two_distinct_slots":true,"pending_output_respects_capacity":true,"third_job_waits":true,"restart":true,"serial_reconfiguration_drains":true,"stale_finish_preserves_successor":true,"changed_slot_rejected":true,"recovery_fences_only_its_key":true,"primary_storage_boundary":true,"per_wallet_target_candidates":32})
}

fn borrowing_campaign(directory: &Path) -> serde_json::Value {
    let path = directory.join("borrowed-refill.sqlite");
    let router = Db::open(&path);
    let policy = Policy::parse(r#"{"wallet_cooldown":{"mode":"enabled","interval_ms":60000},"max_active_operations":1,"max_active_preparations":2,"operation_timeout_ms":30000,"candidate_group_size":2,"preparation_group_size":4,"minimum_ready_batches":8,"refill_target_batches":16}"#).unwrap();
    let owner = key("borrow-owner");
    let waiting = key("borrow-waiting");
    activate(&router, &owner);
    activate(&router, &waiting);
    let first = acquire_borrowed(
        &router,
        &policy,
        &owner,
        m::refill::OccupiedBatches::default(),
        1_000,
    );
    let second = acquire_borrowed(
        &router,
        &policy,
        &owner,
        m::refill::OccupiedBatches::default(),
        1_001,
    );
    assert_ne!(first.producer_slot, second.producer_slot);
    assert_ne!(first.batch, second.batch);
    let pending = tx(&router, m::refill::pending(&router, &owner, 1_002)).unwrap();
    assert_eq!(pending.len(), 2);
    let occupied = m::refill::OccupiedBatches::new(first.batch_ids()).include_pending(&pending);
    assert_eq!(
        occupied.len(),
        4,
        "Visible pending output was counted twice"
    );
    assert!(matches!(
        tx(
            &router,
            m::refill::claim(
                &router,
                &policy,
                waiting.clone(),
                m::refill::OccupiedBatches::default(),
                1_003
            )
        )
        .unwrap(),
        m::refill::Claim::Busy { .. }
    ));
    drop(router);
    let router = Db::open(&path);
    assert!(tx(&router, m::refill::check(&router, &first, 1_004)).unwrap());
    assert!(tx(&router, m::refill::check(&router, &second, 1_004)).unwrap());
    let wake = tx(
        &router,
        m::refill::finish(
            &router,
            &policy,
            &first,
            m::refill::Outcome::Published,
            1_005,
        ),
    )
    .unwrap();
    assert_eq!(wake.first(), Some(&waiting));
    assert!(matches!(
        tx(
            &router,
            m::refill::claim(
                &router,
                &policy,
                owner.clone(),
                m::refill::OccupiedBatches::new(first.batch_ids()),
                1_006
            )
        )
        .unwrap(),
        m::refill::Claim::Busy { .. }
    ));
    let other = acquire_borrowed(
        &router,
        &policy,
        &waiting,
        m::refill::OccupiedBatches::default(),
        1_007,
    );
    assert_eq!(other.producer_slot, first.producer_slot);
    tx(
        &router,
        m::refill::finish(
            &router,
            &policy,
            &second,
            m::refill::Outcome::Published,
            1_008,
        ),
    )
    .unwrap();
    let nearly_full = observed_stock(1);
    let last_pair = acquire_borrowed(&router, &policy, &owner, nearly_full.clone(), 1_009);
    assert_eq!(last_pair.groups, m::refill::Groups::One);
    assert!(matches!(
        tx(
            &router,
            m::refill::claim(&router, &policy, owner.clone(), nearly_full, 1_010)
        )
        .unwrap(),
        m::refill::Claim::Busy { .. }
    ));
    let role = Db::open(&directory.join("borrowed-role.sqlite"));
    tx(&role, pool::install_key(&role, owner.clone())).unwrap();
    for nonce in 1..=16 {
        let mut bound = binding(&owner, Participant::A, nonce);
        bound.expires_at_ms = 11_011;
        let sealed = sealing::seal(Zeroizing::new(vec![7; 100_000]), &bound, &[1; 32]).unwrap();
        tx(&role, pool::put(&role, bound, sealed, 1_011)).unwrap();
    }
    let eligible = tx(
        &role,
        pool::inventory(&role, &owner, 16, 1_012, policy.deadline(1_012).unwrap()),
    )
    .unwrap();
    assert!(
        eligible.ready.is_empty(),
        "The capacity case must include live material outside the signing horizon"
    );
    tx(&role, m::refill::start_role(&role, &last_pair, 1_012)).unwrap();
    let mut overflow = binding(&owner, Participant::A, 17);
    overflow.batch = last_pair.batch;
    overflow.expires_at_ms = last_pair.material_expires_at_ms;
    let sealed = sealing::seal(Zeroizing::new(vec![8; 100_000]), &overflow, &[1; 32]).unwrap();
    assert!(tx(
        &role,
        m::refill::publish_role(&role, &policy, &last_pair, overflow, sealed, 1_013)
    )
    .is_err());
    let stock = tx(&role, pool::inventory(&role, &owner, 16, 1_014, 1_014)).unwrap();
    assert_eq!(
        stock.ready.len(),
        16,
        "Publication exceeded the unchanged pool target"
    );
    tx(
        &router,
        m::refill::finish(
            &router,
            &policy,
            &last_pair,
            m::refill::Outcome::Failed,
            1_015,
        ),
    )
    .unwrap();
    assert!(tx(&router, m::refill::check(&router, &other, 1_016)).unwrap());
    tx(
        &router,
        m::refill::finish(
            &router,
            &policy,
            &other,
            m::refill::Outcome::Published,
            1_017,
        ),
    )
    .unwrap();
    serde_json::json!({"idle_slot_borrowed":true,"independent_jobs":true,"waiting_wallet_precedes_borrower":true,"pending_output_counted_once":true,"restart_preserves_both_leases":true,"bounded_single_pair_top_up":true,"publication_cap_atomic":true,"failed_job_preserves_other_wallet":true})
}

fn acquire_borrowed(
    router: &Db,
    policy: &Policy,
    key: &KeyScope,
    occupied: m::refill::OccupiedBatches,
    now: u64,
) -> m::refill::Job {
    match tx(
        router,
        m::refill::claim(router, policy, key.clone(), occupied, now),
    )
    .unwrap()
    {
        m::refill::Claim::Acquired { job } => job,
        m::refill::Claim::Busy { .. } => {
            panic!("Expected an available, fairly allocated refill slot")
        }
    }
}
