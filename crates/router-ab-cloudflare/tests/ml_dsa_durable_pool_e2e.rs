//! Three durable SQLite stores exercise the same transitions as the Worker objects.
use ::ml_dsa::Keypair;
use router_ab_cloudflare::ml_dsa::{
    self as m,
    admission::{self, Claim, Completion, Decision, Status, UnavailableReason},
    policy::Policy,
    pool, sealing, *,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use sha2::Digest;
use std::{
    future::Future,
    path::{Path, PathBuf},
    time::Duration,
};
use zeroize::Zeroizing;

struct Db(Connection);
impl Db {
    fn open(path: &Path) -> Self {
        let connection = Connection::open(path).unwrap();
        connection.busy_timeout(Duration::from_secs(10)).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            )
            .unwrap();
        Self(connection)
    }
}
impl Store for Db {
    async fn get<T: DeserializeOwned>(&self, key: &str) -> m::Result<Option<T>> {
        let value: Option<String> = self
            .0
            .query_row("SELECT value FROM records WHERE key=?", [key], |row| {
                row.get(0)
            })
            .optional()
            .unwrap();
        Ok(value.map(|text| serde_json::from_str(&text).unwrap()))
    }
    async fn put<T: Serialize>(&self, key: &str, value: &T) -> m::Result<()> {
        self.0.execute("INSERT INTO records(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, &serde_json::to_string(value).unwrap()]).unwrap();
        Ok(())
    }
    async fn delete(&self, key: &str) -> m::Result<()> {
        self.0
            .execute("DELETE FROM records WHERE key=?", [key])
            .unwrap();
        Ok(())
    }
}
fn tx<T>(db: &Db, work: impl Future<Output = m::Result<T>>) -> m::Result<T> {
    db.0.execute_batch("BEGIN IMMEDIATE").unwrap();
    let result = futures::executor::block_on(work);
    db.0.execute_batch(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })
        .unwrap();
    result
}
fn id(text: &str) -> Identifier {
    Identifier::try_from(text.to_owned()).unwrap()
}
fn key(wallet: &str) -> KeyScope {
    KeyScope {
        wallet: WalletScope {
            org: id("org"),
            project: id("project"),
            environment: id("local-e2e"),
            wallet: id(wallet),
        },
        key_id: id("near-ml-dsa"),
        epoch: 1,
        public_key_digest: [7; 32],
        schedule_digest: [8; 32],
    }
}
fn request(key: &KeyScope, operation: u8) -> SigningRequest {
    SigningRequest {
        key: key.clone(),
        operation: [operation; 32],
        message_digest: [9; 32],
        context_digest: [10; 32],
    }
}
fn claim(db: &Db, policy: &Policy, request: SigningRequest, now: u64) -> Claim {
    activate(db, &request.key);
    match tx(db, admission::begin(db, policy, request, now)).unwrap() {
        Decision::Claimed { claim } => claim,
        other => panic!("Expected claim, got {other:?}"),
    }
}
fn activate(db: &Db, key: &KeyScope) {
    tx(
        db,
        admission::authorize_key(
            db,
            admission::KeyActivation {
                key: key.clone(),
                ceremony_id: [44; 32],
                manifest_digest: [45; 32],
            },
        ),
    )
    .unwrap();
    let state = tx(db, admission::key_state(db, key)).unwrap().unwrap();
    tx(db, admission::commit_key(db, state.activation().clone())).unwrap();
}
fn binding(key: &KeyScope, role: Participant, batch: u8) -> sealing::Binding {
    sealing::Binding {
        key: key.clone(),
        role,
        batch: [batch; 32],
        expires_at_ms: 1_000_000,
        wrapping_key_version: id("kek-1"),
    }
}
fn fill(db: &Db, key: &KeyScope, role: Participant, seed: &[u8; 32], start: u8) {
    tx(db, pool::install_key(db, key.clone())).unwrap();
    for batch in start..start + 3 {
        let binding = binding(key, role, batch);
        let sealed = sealing::seal(Zeroizing::new(vec![batch; 100_000]), &binding, seed).unwrap();
        let wire = serde_json::to_vec(&sealed).unwrap();
        let sealed = serde_json::from_slice(&wire).unwrap();
        tx(db, pool::put(db, binding, sealed, 1_000)).unwrap();
    }
}
fn race(path: PathBuf, key: KeyScope, operation: u8) -> Decision {
    let db = Db::open(&path);
    activate(&db, &key);
    tx(
        &db,
        admission::begin(&db, &Policy::default(), request(&key, operation), 300_000),
    )
    .unwrap()
}
#[test]
fn durable_admission_pool_restart_and_concurrent_claims() {
    let directory = std::env::temp_dir().join(format!("ml-dsa-pool-e2e-{}", std::process::id()));
    std::fs::create_dir(&directory).unwrap();
    let service_path = directory.join("router.sqlite");
    let a_path = directory.join("a.sqlite");
    let b_path = directory.join("b.sqlite");
    let router = Db::open(&service_path);
    let a = Db::open(&a_path);
    let b = Db::open(&b_path);
    let key = key("wallet");
    let policy = Policy::default();
    fill(&a, &key, Participant::A, &[1; 32], 0);
    fill(&b, &key, Participant::B, &[2; 32], 0);
    drop(a);
    drop(b);
    let a = Db::open(&a_path);
    let b = Db::open(&b_path);
    let first = request(&key, 1);
    let activation = admission::KeyActivation {
        key: key.clone(), ceremony_id: [44; 32], manifest_digest: [45; 32],
    };
    tx(&router, admission::authorize_key(&router, activation.clone())).unwrap();
    assert!(tx(&router, admission::active_key(&router, &key)).unwrap().is_none());
    assert!(tx(&router, admission::begin(&router, &policy, first.clone(), 1_000)).is_err());
    drop(router);
    let router = Db::open(&service_path);
    assert!(matches!(tx(&router, admission::key_state(&router, &key)).unwrap(),
        Some(admission::KeyState::Installing { .. })));
    let mut changed_activation = activation.clone();
    changed_activation.ceremony_id = [46; 32];
    assert!(tx(&router, admission::commit_key(&router, changed_activation)).is_err());
    let first_claim = claim(&router, &policy, first.clone(), 1_000);
    assert!(matches!(
        tx(
            &router,
            admission::begin(&router, &policy, first.clone(), 1_001)
        )
        .unwrap(),
        Decision::Existing {
            operation: Status::Preparing { .. }
        }
    ));
    let mut changed = first.clone();
    changed.message_digest = [99; 32];
    assert!(tx(&router, admission::begin(&router, &policy, changed, 1_001)).is_err());
    let batches = vec![[0; 32], [1; 32], [2; 32]];
    tx(
        &a,
        pool::reserve(&a, &first, &batches, first_claim.expires_at_ms, 1_001),
    )
    .unwrap();
    tx(
        &b,
        pool::reserve(&b, &first, &batches, first_claim.expires_at_ms, 1_001),
    )
    .unwrap();
    let permit = match tx(
        &router,
        admission::admit(&router, &policy, first_claim, batches.clone(), 1_002),
    )
    .unwrap()
    {
        Decision::Admitted { permit } => permit,
        _ => panic!(),
    };
    let reserved_inventory = tx(&a, pool::inventory(&a, &key, 3, 1_002, 1_002)).unwrap();
    assert!(reserved_inventory.ready.is_empty());
    assert_eq!(reserved_inventory.reserved, batches);
    assert!(!reserved_inventory.refill_due);
    let (own_binding, sealed) =
        tx(&a, pool::take(&a, Participant::A, &permit, [0; 32], 1_003)).unwrap();
    assert_eq!(
        sealing::open(sealed, &own_binding, &[1; 32]).unwrap().len(),
        100_000
    );
    let after_take = tx(&a, pool::inventory(&a, &key, 3, 1_003, 1_003)).unwrap();
    assert!(after_take.ready.is_empty());
    assert_eq!(after_take.reserved, vec![[1; 32], [2; 32]]);
    assert!(after_take.refill_due);
    drop(a);
    let a = Db::open(&a_path);
    assert!(tx(&a, pool::take(&a, Participant::A, &permit, [0; 32], 1_004)).is_err());
    assert!(tx(&b, pool::take(&b, Participant::A, &permit, [0; 32], 1_004)).is_err());
    let wrong_role_binding = binding(&key, Participant::B, 99);
    let wrong_role_envelope = sealing::seal(
        Zeroizing::new(vec![5; 100_000]),
        &wrong_role_binding,
        &[2; 32],
    )
    .unwrap();
    assert!(sealing::open(wrong_role_envelope, &wrong_role_binding, &[1; 32]).is_err());
    assert!(
        tx(&a, pool::inventory(&a, &key, 10, 1_004, 1_004))
            .unwrap()
            .refill_due
    );
    // An admitted failure still consumes the cooldown; untouched material survives.
    tx(
        &router,
        admission::finish(&router, &permit, Completion::Failed, 1_005),
    )
    .unwrap();
    tx(&a, pool::fence(&a, &first, &batches)).unwrap();
    tx(&b, pool::fence(&b, &first, &batches)).unwrap();
    tx(
        &a,
        pool::release(&a, &first, &batches, pool::Settlement::Failed, &[]),
    )
    .unwrap();
    tx(
        &b,
        pool::release(&b, &first, &batches, pool::Settlement::Failed, &[]),
    )
    .unwrap();
    assert!(tx(&a, pool::inventory(&a, &key, 10, 1_006, 1_006))
        .unwrap()
        .ready
        .is_empty());
    assert!(tx(&b, pool::inventory(&b, &key, 10, 1_006, 1_006))
        .unwrap()
        .ready
        .is_empty());
    fill(&a, &key, Participant::A, &[1; 32], 10);
    fill(&b, &key, Participant::B, &[2; 32], 10);
    drop(router);
    let router = Db::open(&service_path);
    assert!(matches!(
        tx(
            &router,
            admission::begin(&router, &policy, first.clone(), 1_006)
        )
        .unwrap(),
        Decision::Existing {
            operation: Status::Failed
        }
    ));
    let mut other_key = key.clone();
    other_key.key_id = id("another-key");
    activate(&router, &other_key);
    activate(&router, &self::key("other-wallet"));
    activate(&router, &self::key("other"));
    assert!(matches!(
        tx(
            &router,
            admission::begin(&router, &policy, request(&other_key, 2), 61_001)
        )
        .unwrap(),
        Decision::Unavailable {
            reason: UnavailableReason::WalletCooldown,
            retry_at_ms: 61_002
        }
    ));
    let second = claim(&router, &policy, request(&key, 2), 61_002);
    assert!(matches!(
        tx(
            &router,
            admission::begin(
                &router,
                &policy,
                request(&self::key("other-wallet"), 3),
                61_003
            )
        )
        .unwrap(),
        Decision::Unavailable {
            reason: UnavailableReason::ServiceCapacity,
            ..
        }
    ));
    tx(&router, admission::cancel(&router, &second)).unwrap();
    // Empty-pool refusal does not charge a new cooldown.
    let empty = claim(&router, &policy, request(&key, 4), 61_004);
    assert!(matches!(
        tx(
            &router,
            admission::admit(&router, &policy, empty, vec![], 61_005)
        )
        .unwrap(),
        Decision::Unavailable {
            reason: UnavailableReason::EmptyPool,
            ..
        }
    ));
    let configured=Policy::parse(r#"{"wallet_cooldown":{"mode":"enabled","interval_ms":300000},"max_active_operations":1,"operation_timeout_ms":30000,"minimum_ready_batches":2,"refill_target_batches":10}"#).unwrap();
    let next = claim(&router, &configured, request(&key, 5), 61_006);
    let long = match tx(
        &router,
        admission::admit(&router, &configured, next, vec![[1; 32], [2; 32]], 61_007),
    )
    .unwrap()
    {
        Decision::Admitted { permit } => permit,
        _ => panic!(),
    };
    tx(
        &router,
        admission::finish(&router, &long, Completion::Failed, 61_008),
    )
    .unwrap();
    assert!(matches!(
        tx(
            &router,
            admission::begin(&router, &configured, request(&key, 6), 361_006)
        )
        .unwrap(),
        Decision::Unavailable {
            reason: UnavailableReason::WalletCooldown,
            retry_at_ms: 361_007
        }
    ));
    let disabled=Policy::parse(r#"{"wallet_cooldown":{"mode":"disabled"},"max_active_operations":1,"operation_timeout_ms":30000,"minimum_ready_batches":2,"refill_target_batches":10}"#).unwrap();
    let no_cooldown = claim(&router, &disabled, request(&key, 7), 61_009);
    assert!(matches!(
        tx(
            &router,
            admission::begin(&router, &disabled, request(&self::key("other"), 8), 61_010)
        )
        .unwrap(),
        Decision::Unavailable {
            reason: UnavailableReason::ServiceCapacity,
            ..
        }
    ));
    tx(&router, admission::cancel(&router, &no_cooldown)).unwrap();
    // A failed multi-record reservation rolls back its earlier writes.
    let rollback = request(&key, 9);
    assert!(tx(
        &a,
        pool::reserve(&a, &rollback, &[[10; 32], [255; 32]], 100_000, 62_000)
    )
    .is_err());
    assert_eq!(
        tx(&a, pool::inventory(&a, &key, 10, 62_000, 62_000))
            .unwrap()
            .ready
            .len(),
        3
    );
    // A late one-sided take cannot create an orphan after successful settlement.
    let settling = request(&key, 99);
    let settling_batches = vec![[10; 32], [11; 32], [12; 32]];
    tx(
        &a,
        pool::reserve(&a, &settling, &settling_batches, 65_000, 62_000),
    )
    .unwrap();
    tx(
        &b,
        pool::reserve(&b, &settling, &settling_batches, 65_000, 62_000),
    )
    .unwrap();
    let settling_permit = admission::Permit {
        request: settling.clone(),
        expires_at_ms: 65_000,
        batches: settling_batches.clone(),
    };
    tx(
        &a,
        pool::take(&a, Participant::A, &settling_permit, [10; 32], 62_001),
    )
    .unwrap();
    tx(
        &b,
        pool::take(&b, Participant::B, &settling_permit, [10; 32], 62_001),
    )
    .unwrap();
    tx(
        &a,
        pool::take(&a, Participant::A, &settling_permit, [11; 32], 62_002),
    )
    .unwrap();
    let mut consumed_union = tx(&a, pool::fence(&a, &settling, &settling_batches)).unwrap();
    for batch in tx(&b, pool::fence(&b, &settling, &settling_batches)).unwrap() {
        if !consumed_union.contains(&batch) {
            consumed_union.push(batch);
        }
    }
    assert!(tx(
        &b,
        pool::take(&b, Participant::B, &settling_permit, [11; 32], 62_003)
    )
    .is_err());
    assert!(tx(
        &a,
        pool::reserve(&a, &settling, &settling_batches, 65_000, 62_003)
    )
    .is_err());
    tx(
        &a,
        pool::release(
            &a,
            &settling,
            &settling_batches,
            pool::Settlement::Succeeded,
            &consumed_union,
        ),
    )
    .unwrap();
    tx(
        &b,
        pool::release(
            &b,
            &settling,
            &settling_batches,
            pool::Settlement::Succeeded,
            &consumed_union,
        ),
    )
    .unwrap();
    assert_eq!(
        tx(&a, pool::inventory(&a, &key, 10, 62_004, 62_004))
            .unwrap()
            .ready,
        vec![[12; 32]]
    );
    assert_eq!(
        tx(&b, pool::inventory(&b, &key, 10, 62_004, 62_004))
            .unwrap()
            .ready,
        vec![[12; 32]]
    );
    // A lost pre-admission cleanup can leave an unmatched ready half. Retire it
    // only after observing the peer's permanent tombstone, never on Missing.
    let abandoned = request(&key, 98);
    tx(
        &a,
        pool::reserve(&a, &abandoned, &[[12; 32]], 63_000, 62_100),
    )
    .unwrap();
    assert!(tx(&a, pool::inventory(&a, &key, 10, 63_001, 63_001))
        .unwrap()
        .ready
        .is_empty());
    assert_eq!(
        tx(&a, pool::inspect(&a, &key, &[[12; 32], [250; 32]])).unwrap(),
        vec![
            pool::BatchAvailability::Retired,
            pool::BatchAvailability::Missing
        ]
    );
    tx(&b, pool::retire_unpaired(&b, &key, &[[12; 32]])).unwrap();
    assert!(tx(&b, pool::inventory(&b, &key, 10, 63_002, 63_002))
        .unwrap()
        .ready
        .is_empty());
    // Refilling another key slot cannot erase this slot's pending request.
    let mut sibling = key.clone();
    sibling.key_id = id("sibling");
    fill(&a, &sibling, Participant::A, &[1; 32], 100);
    tx(&a, pool::inventory(&a, &sibling, 1, 62_000, 62_000)).unwrap();
    assert!(matches!(
        tx(&a, pool::refill_status(&a, &sibling, 62_000)).unwrap(),
        pool::RefillStatus::Sufficient
    ));
    assert!(
        matches!(tx(&a, pool::refill_status(&a, &key, 62_000)).unwrap(), pool::RefillStatus::Requested { key: pending, .. } if pending == key)
    );
    // A ready record must remain valid throughout the admitted operation.
    assert!(tx(&a, pool::inventory(&a, &sibling, 1, 999_999, 1_000_001))
        .unwrap()
        .ready
        .is_empty());
    // Recovery advances the epoch and burns all older preparation.
    let mut substituted = key.clone();
    substituted.epoch = 2;
    substituted.public_key_digest = [66; 32];
    assert!(tx(
        &router,
        admission::authorize_key(
            &router,
            admission::KeyActivation {
                key: substituted.clone(),
                ceremony_id: [67; 32],
                manifest_digest: [68; 32],
            }
        )
    )
    .is_err());
    assert!(tx(&a, pool::install_key(&a, substituted)).is_err());
    let mut recovered = key.clone();
    recovered.epoch = 2;
    let recovered_activation = admission::KeyActivation {
        key: recovered.clone(), ceremony_id: [44; 32], manifest_digest: [45; 32],
    };
    tx(&router, admission::authorize_key(&router, recovered_activation)).unwrap();
    assert!(tx(&router, admission::active_key(&router, &recovered)).unwrap().is_none());
    assert!(tx(&router, admission::commit_key(&router, activation)).is_err());
    activate(&router, &recovered);
    tx(&a, pool::install_key(&a, recovered.clone())).unwrap();
    assert!(tx(&a, pool::inventory(&a, &key, 10, 62_001, 62_001)).is_err());
    assert!(tx(&a, pool::inventory(&a, &recovered, 10, 62_001, 62_001))
        .unwrap()
        .ready
        .is_empty());
    assert!(tx(&a, pool::install_key(&a, key.clone())).is_err());
    let replay_binding = binding(&recovered, Participant::A, 0);
    let replay =
        sealing::seal(Zeroizing::new(vec![0; 100_000]), &replay_binding, &[1; 32]).unwrap();
    assert!(tx(&a, pool::put(&a, replay_binding, replay, 62_002)).is_err());
    // Two independent connections contend for the global service slot.
    let path_a = service_path.clone();
    let path_b = service_path.clone();
    let key_a = self::key("racing-a");
    let key_b = self::key("racing-b");
    let left = std::thread::spawn(move || race(path_a, key_a, 20));
    let right = std::thread::spawn(move || race(path_b, key_b, 21));
    let outcomes = [left.join().unwrap(), right.join().unwrap()];
    assert_eq!(
        outcomes
            .iter()
            .filter(|value| matches!(value, Decision::Claimed { .. }))
            .count(),
        1
    );
    // Completion verifies the exact admitted inputs and persists an idempotent result.
    let ordinary = ::ml_dsa::SigningKey::<::ml_dsa::MlDsa65>::from_seed(&[6; 32].into());
    let public_key = ordinary.verifying_key().encode().to_vec();
    let message = b"router-completion".to_vec();
    let context = b"private-e2e".to_vec();
    let signature = ordinary
        .expanded_key()
        .sign_deterministic(&message, &context)
        .unwrap()
        .encode()
        .to_vec();
    let mut verified_key = self::key("verified-wallet");
    verified_key.public_key_digest = sha2::Sha256::digest(&public_key).into();
    let mut verified_request = request(&verified_key, 30);
    verified_request.message_digest = sha2::Sha256::digest(&message).into();
    verified_request.context_digest = sha2::Sha256::digest(&context).into();
    let verified_claim = claim(&router, &policy, verified_request.clone(), 500_000);
    let verified_permit = match tx(
        &router,
        admission::admit(
            &router,
            &policy,
            verified_claim,
            vec![[30; 32], [31; 32]],
            500_001,
        ),
    )
    .unwrap()
    {
        Decision::Admitted { permit } => permit,
        _ => panic!(),
    };
    let mut changed_signature = signature.clone();
    changed_signature[0] ^= 1;
    assert!(tx(
        &router,
        admission::finish(
            &router,
            &verified_permit,
            Completion::Succeeded {
                public_key: public_key.clone(),
                message: message.clone(),
                context: context.clone(),
                signature: changed_signature,
            },
            500_002
        )
    )
    .is_err());
    let success = tx(
        &router,
        admission::finish(
            &router,
            &verified_permit,
            Completion::Succeeded {
                public_key,
                message,
                context,
                signature: signature.clone(),
            },
            500_003,
        ),
    )
    .unwrap();
    assert_eq!(success, Status::Succeeded { signature });
    drop(router);
    let router = Db::open(&service_path);
    assert_eq!(
        tx(
            &router,
            admission::lookup(&router, &verified_request, 500_004)
        )
        .unwrap(),
        Some(success)
    );
    // Preprocessing uses a separate global lease and fresh IDs after interruption.
    let refill_key = self::key("refill-wallet");
    activate(&router, &refill_key);
    tx(&a, pool::install_key(&a, refill_key.clone())).unwrap_err();
    let refill_store_path = directory.join("refill.sqlite");
    let refill_store = Db::open(&refill_store_path);
    tx(
        &refill_store,
        pool::install_key(&refill_store, refill_key.clone()),
    )
    .unwrap();
    let m::refill::Claim::Acquired { job } = tx(
        &router,
        m::refill::claim(&router, refill_key.clone(), 600_000),
    )
    .unwrap() else {
        panic!("Missing preprocessing lease")
    };
    assert!(matches!(
        tx(
            &router,
            m::refill::claim(&router, refill_key.clone(), 600_001)
        )
        .unwrap(),
        m::refill::Claim::Busy { .. }
    ));
    tx(
        &refill_store,
        m::refill::start_role(&refill_store, &job, 600_001),
    )
    .unwrap();
    drop(refill_store);
    let refill_store = Db::open(&refill_store_path);
    assert!(tx(
        &refill_store,
        m::refill::start_role(&refill_store, &job, 600_002)
    )
    .is_err());
    assert!(!tx(&router, m::refill::check(&router, &job, job.expires_at_ms)).unwrap());
    let m::refill::Claim::Acquired { job: replacement } = tx(
        &router,
        m::refill::claim(&router, refill_key, job.expires_at_ms),
    )
    .unwrap() else {
        panic!("Lease expiry did not release capacity")
    };
    assert_ne!(job.batch, replacement.batch);
    tx(&router, m::refill::finish(&router, &job)).unwrap();
    assert!(tx(
        &router,
        m::refill::check(&router, &replacement, replacement.expires_at_ms - 1)
    )
    .unwrap());
    tx(&router, m::refill::finish(&router, &replacement)).unwrap();
    drop(refill_store);
    let output = std::env::var_os("ML_DSA_E2E_REPORT")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("ml-dsa-durable-admission-e2e.json"));
    std::fs::write(&output,serde_json::to_vec_pretty(&serde_json::json!({
        "pending_activation_blocks_signing":true,"pending_activation_survives_restart":true,"stale_activation_commit_rejected":true,"recovery_waits_for_installation":true,"reserved_stock_does_not_trigger_refill":true,"consumption_triggers_refill":true,"preprocessing_capacity_and_restart_replay":true,"expired_preprocessing_uses_fresh_id":true,"schema":"seams.ml-dsa-durable-admission-e2e.v1","passed":true,"production_eligible":false,"worker_http_routes_exercised":false,"successful_settlement_fences_and_reconciles":true,"interrupted_reservation_orphans_retired":true,"separate_sqlite_stores":4,
        "restart_and_single_use":true,"one_sided_take_failure_burns_both_pools":true,"refill_requests_are_key_scoped":true,"readiness_covers_operation_lifetime":true,"changed_message_replay_rejected":true,"cross_role_open_rejected":true,
        "cooldown_across_keys_and_restart":true,"five_minute_configuration":true,"disabled_cooldown_preserves_capacity":true,
        "empty_pool_not_charged":true,"partial_write_rollback":true,"recovery_epoch_retires_preparation":true,"recovery_cannot_substitute_public_key":true,
        "concurrent_service_claim_winners":1,"verified_completion_and_restart_replay":true,"scope":"Transactional lifecycle and encrypted storage E2E. Synthetic prepared bytes. Real threshold persistence is covered by the investigation harness. No hosted latency claim."
    })).unwrap()).unwrap();
    drop(a);
    drop(b);
    drop(router);
    std::fs::remove_dir_all(directory).unwrap();
    eprintln!("ML-DSA lifecycle evidence: {}", output.display());
}
