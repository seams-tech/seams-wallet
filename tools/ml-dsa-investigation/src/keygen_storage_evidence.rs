//! Real prepared keygen crosses encrypted SQLite storage before any wallet input selection.
use crate::{
    InvestigationResult,
    durable_preparation_evidence::{Db, identifier, tx},
    require,
};
use ed25519_yao::{
    ml_dsa_runtime::{TrustedMlDsaSchedule, prepared::keygen::PreparedKeygen},
    ml_dsa_signing::SigningRole,
};
use router_ab_cloudflare::ml_dsa::{self as m, Participant, registration_preparation as pool};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::Path;
use zeroize::Zeroizing;

pub(super) fn roundtrip<'a>(
    prepared: PreparedKeygen<'a>,
    role: SigningRole,
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    directory: &Path,
) -> InvestigationResult<(PreparedKeygen<'a>, Value)> {
    let reservation = [51; 32];
    let binding = pool::Binding {
        pool_scope: Sha256::digest(b"disposable-keygen-storage-e2e").into(),
        role: match role {
            SigningRole::A => Participant::A,
            SigningRole::B => Participant::B,
        },
        reservation,
        schedule_digest: m::execution::schedule_digest(schedules),
        expires_at_ms: 100_000,
        wrapping_key_version: identifier("test-keygen-1")?,
    };
    let mut seed = Zeroizing::new([0; 32]);
    getrandom::getrandom(seed.as_mut())?;
    let bytes = prepared.into_storage(reservation);
    let size = bytes.len();
    let sealed = pool::seal(bytes, &binding, &seed)?;
    let encoded = serde_json::to_vec(&sealed)?;
    let database = directory.join("registration-preparation.sqlite");
    let db = Db::open(&database)?;
    tx(&db, pool::publish(&db, binding.clone(), sealed, 1))?;
    tx(
        &db,
        pool::publish(&db, binding.clone(), serde_json::from_slice(&encoded)?, 2),
    )?;
    drop(db);
    let db = Db::open(&database)?;
    let mut changed = binding.clone();
    changed.role = match binding.role {
        Participant::A => Participant::B,
        Participant::B => Participant::A,
    };
    require(
        tx(&db, pool::consume(&db, &changed, [52; 32], 3)).is_err(),
        "Cross-role consumption accepted",
    )?;
    require(
        tx(
            &db,
            pool::consume(&db, &binding, [52; 32], binding.expires_at_ms),
        )
        .is_err(),
        "Expired preparation accepted",
    )?;
    let sealed = tx(&db, pool::consume(&db, &binding, [52; 32], 3))?;
    drop(db);
    let db = Db::open(&database)?;
    require(
        tx(&db, pool::consume(&db, &binding, [52; 32], 4)).is_err(),
        "Consumed keygen preparation replayed after restart",
    )?;
    require(
        tx(
            &db,
            pool::publish(&db, binding.clone(), serde_json::from_slice(&encoded)?, 4),
        )
        .is_err(),
        "Consumed preparation republished",
    )?;
    require(
        pool::open(serde_json::from_slice(&encoded)?, &changed, &seed).is_err(),
        "Cross-role envelope opened",
    )?;
    let bytes = pool::open(sealed, &binding, &seed)?;
    let peer = match role {
        SigningRole::A => SigningRole::B,
        SigningRole::B => SigningRole::A,
    };
    require(
        PreparedKeygen::from_consumed_storage(peer, reservation, schedules, bytes.clone()).is_err(),
        "Private state restored for another role",
    )?;
    require(
        PreparedKeygen::from_consumed_storage(role, [53; 32], schedules, bytes.clone()).is_err(),
        "Private state restored for another reservation",
    )?;
    let mut truncated = bytes.clone();
    truncated.pop();
    require(
        PreparedKeygen::from_consumed_storage(role, reservation, schedules, truncated).is_err(),
        "Truncated private state restored",
    )?;
    let mut extended = bytes.clone();
    extended.push(0);
    require(
        PreparedKeygen::from_consumed_storage(role, reservation, schedules, extended).is_err(),
        "Trailing private state restored",
    )?;
    require(
        PreparedKeygen::from_consumed_storage(role, reservation, &schedules[..4], bytes.clone())
            .is_err(),
        "Missing schedule accepted",
    )?;
    let restored = PreparedKeygen::from_consumed_storage(role, reservation, schedules, bytes)?;
    Ok((
        restored,
        json!({
            "private_state_bytes":size, "sealed_bytes":encoded.len(),
            "sqlite_reopened_before_consume":true, "consume_replay_rejected_after_restart":true,
            "duplicate_publish_idempotent":true, "republish_consumed_rejected":true,
            "wrong_role_rejected":true, "wrong_reservation_rejected":true,
            "expired_reservation_rejected":true, "truncated_and_extended_state_rejected":true,
            "missing_schedule_rejected":true,
            "scope":"Role-private keygen state sealed and consumed through SQLite. Table frames use the existing disposable host adapter. No Worker registration route or persistent table authentication is qualified."
        }),
    ))
}
