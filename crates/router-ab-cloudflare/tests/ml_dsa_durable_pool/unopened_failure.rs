use super::admission::Permit;
use super::*;

pub(super) fn campaign(directory: &Path) -> serde_json::Value {
    let a_path = directory.join("unopened-a.sqlite");
    let b_path = directory.join("unopened-b.sqlite");
    let a = Db::open(&a_path);
    let b = Db::open(&b_path);
    let key = key("unopened-failure");
    fill(&a, &key, Participant::A, &[1; 32], 70, 4);
    fill(&b, &key, Participant::B, &[2; 32], 70, 4);
    let old = request(&key, 60);
    let batches = vec![[70; 32], [71; 32], [72; 32], [73; 32]];
    for db in [&a, &b] {
        tx(db, pool::reserve(db, &old, &batches, 90_000, 2_000)).unwrap();
    }
    let permit = Permit {
        request: old.clone(),
        expires_at_ms: 90_000,
        batches: batches.clone(),
    };
    // The role commits consumption before a transport failure hides its reply.
    tx(&a, pool::take(&a, Participant::A, &permit, [70; 32], 2_001)).unwrap();
    tx(&b, pool::take(&b, Participant::B, &permit, [70; 32], 2_001)).unwrap();
    tx(&a, pool::take(&a, Participant::A, &permit, [71; 32], 2_002)).unwrap();
    let first_a = tx(&a, pool::fence(&a, &old, &batches)).unwrap();
    let first_b = tx(&b, pool::fence(&b, &old, &batches)).unwrap();
    let unopened: Vec<_> = first_a
        .unopened
        .iter()
        .filter(|id| first_b.unopened.contains(id))
        .copied()
        .collect();
    assert_eq!(unopened, vec![[72; 32], [73; 32]]);
    let consumed = vec![[70; 32], [71; 32]];
    assert!(tx(&b, pool::take(&b, Participant::B, &permit, [71; 32], 2_003)).is_err());
    assert!(tx(
        &a,
        pool::release(
            &a,
            &old,
            &batches,
            pool::Settlement::Failed,
            &consumed,
            &[[71; 32]]
        )
    )
    .is_err());
    tx(
        &a,
        pool::release(
            &a,
            &old,
            &batches,
            pool::Settlement::Failed,
            &consumed,
            &unopened,
        ),
    )
    .unwrap();
    // A reply is lost after A releases. Restart and repeat both fences before B releases.
    drop(a);
    let a = Db::open(&a_path);
    assert_eq!(tx(&a, pool::fence(&a, &old, &batches)).unwrap(), first_a);
    assert_eq!(tx(&b, pool::fence(&b, &old, &batches)).unwrap(), first_b);
    assert!(tx(&a, pool::fence(&a, &old, &[[72; 32]])).is_err());
    tx(
        &a,
        pool::release(
            &a,
            &old,
            &batches,
            pool::Settlement::Failed,
            &consumed,
            &unopened,
        ),
    )
    .unwrap();
    tx(
        &b,
        pool::release(
            &b,
            &old,
            &batches,
            pool::Settlement::Failed,
            &consumed,
            &unopened,
        ),
    )
    .unwrap();
    for db in [&a, &b] {
        assert_eq!(
            tx(db, pool::inventory(db, &key, 4, 2_004, 2_004))
                .unwrap()
                .ready,
            unopened
        );
    }
    let next = request(&key, 61);
    for db in [&a, &b] {
        tx(db, pool::reserve(db, &next, &unopened, 90_000, 2_005)).unwrap();
    }
    // A delayed old release cannot change a fresh reservation's ownership.
    for db in [&a, &b] {
        tx(
            db,
            pool::release(
                db,
                &old,
                &batches,
                pool::Settlement::Failed,
                &consumed,
                &unopened,
            ),
        )
        .unwrap();
    }
    let next_permit = Permit {
        request: next,
        expires_at_ms: 90_000,
        batches: unopened.clone(),
    };
    assert!(tx(&a, pool::take(&a, Participant::A, &permit, [72; 32], 2_006)).is_err());
    for (db, role, seed) in [(&a, Participant::A, [1; 32]), (&b, Participant::B, [2; 32])] {
        let (binding, ciphertext) =
            tx(db, pool::take(db, role, &next_permit, [72; 32], 2_007)).unwrap();
        assert_eq!(
            sealing::open(ciphertext, &binding, &seed)
                .unwrap()
                .as_slice(),
            &[72; 100_000]
        );
        assert!(tx(db, pool::take(db, role, &next_permit, [72; 32], 2_008)).is_err());
    }
    expiry_ordering(directory, false);
    expiry_ordering(directory, true);
    serde_json::json!({"expiry_before_fence":true,"expiry_after_fence":true,"late_release_preserves_fresh_reservation":true,"retained_pairs":2,"uncertain_pairs_retired":2,"restart_after_partial_release":true,"late_old_take_rejected":true,"fresh_single_use_decryption":true,"synthetic_material_only":true})
}

fn expiry_ordering(directory: &Path, fence_first: bool) {
    let path = directory.join(format!("expired-unopened-{fence_first}.sqlite"));
    let db = Db::open(&path);
    let key = key("expired-unopened");
    fill(&db, &key, Participant::B, &[2; 32], 80, 3);
    let old = request(&key, 62);
    let batches = vec![[80; 32], [81; 32], [82; 32]];
    tx(&db, pool::reserve(&db, &old, &batches, 3_000, 2_000)).unwrap();
    let permit = Permit {
        request: old.clone(),
        expires_at_ms: 3_000,
        batches: batches.clone(),
    };
    tx(
        &db,
        pool::take(&db, Participant::B, &permit, [80; 32], 2_001),
    )
    .unwrap();
    if fence_first {
        tx(&db, pool::fence(&db, &old, &batches)).unwrap();
    }
    let expired = tx(&db, pool::expired_reservations(&db, &key, 3_001)).unwrap();
    assert_eq!(expired.len(), 1);
    assert_eq!(expired[0].batches, vec![[81; 32], [82; 32]]);
    tx(
        &db,
        pool::settle_expired(&db, &expired[0], pool::Settlement::Failed),
    )
    .unwrap();
    let proof = tx(&db, pool::fence(&db, &old, &batches)).unwrap();
    tx(
        &db,
        pool::release(
            &db,
            &old,
            &batches,
            pool::Settlement::Failed,
            &proof.consumed,
            &proof.unopened,
        ),
    )
    .unwrap();
    assert!(tx(&db, pool::inventory(&db, &key, 3, 3_002, 3_002))
        .unwrap()
        .ready
        .is_empty());
    assert!(tx(
        &db,
        pool::take(&db, Participant::B, &permit, [81; 32], 3_003)
    )
    .is_err());
}
