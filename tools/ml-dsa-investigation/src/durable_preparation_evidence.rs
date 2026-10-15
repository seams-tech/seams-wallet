//! Real preparation survives sealed SQLite storage before threshold signing.
use crate::{InvestigationResult, boolean_engine_evidence::run_ready, require};
use ed25519_yao::{
    ml_dsa_runtime::{TrustedMlDsaSchedule, boolean_comparison::prepared::PublicTopologies},
    ml_dsa_signing::{SigningRole, prepared_signing::gmw::PreparedGmwReservation},
};
use router_ab_cloudflare::ml_dsa::{self as durable, admission::Permit, pool, sealing, *};
use rusqlite::{Connection, OptionalExtension};
use serde::{Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::{future::Future, path::Path};
use zeroize::Zeroizing;
pub(super) struct Db(Connection);
impl Db {
    pub(super) fn remaining_registration_table_chunks(&self) -> InvestigationResult<usize> {
        Ok(self.0.query_row(
            "SELECT COUNT(*) FROM records WHERE key LIKE 'registration-tables/%/ciphertext/%'",
            [], |row| row.get(0),
        )?)
    }
    pub(super) fn open(path: &Path) -> InvestigationResult<Self> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        )?;
        Ok(Self(connection))
    }
}
pub(super) fn error(_: impl core::fmt::Display) -> router_ab_core::RouterAbProtocolError {
    router_ab_core::RouterAbProtocolError::new(
        router_ab_core::RouterAbProtocolErrorCode::InvalidGateDecision,
        "Durable ML-DSA E2E storage failed",
    )
}
impl Store for Db {
    async fn get<T: DeserializeOwned>(&self, key: &str) -> durable::Result<Option<T>> {
        let text: Option<String> = self
            .0
            .query_row("SELECT value FROM records WHERE key=?", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(error)?;
        text.map(|text| serde_json::from_str(&text).map_err(error))
            .transpose()
    }
    async fn put<T: Serialize>(&self, key: &str, value: &T) -> durable::Result<()> {
        self.0.execute("INSERT INTO records(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[key,&serde_json::to_string(value).map_err(error)?]).map_err(error)?;
        Ok(())
    }
    async fn delete(&self, key: &str) -> durable::Result<()> {
        self.0
            .execute("DELETE FROM records WHERE key=?", [key])
            .map_err(error)?;
        Ok(())
    }
}
pub(super) fn tx<T>(
    db: &Db,
    work: impl Future<Output = durable::Result<T>>,
) -> InvestigationResult<T> {
    db.0.execute_batch("BEGIN IMMEDIATE")?;
    let result = run_ready(work)?;
    db.0.execute_batch(if result.is_ok() { "COMMIT" } else { "ROLLBACK" })?;
    Ok(result?)
}
pub(super) fn identifier(value: &str) -> InvestigationResult<Identifier> {
    Ok(Identifier::try_from(value.to_owned())?)
}
pub(super) fn roundtrip<'a>(
    role: SigningRole,
    prepared: PreparedGmwReservation<'a>,
    id: [u8; 32],
    candidates: u16,
    schedules: &'a [TrustedMlDsaSchedule<'a>],
    public_key: &[u8],
    directory: &Path,
) -> InvestigationResult<PreparedGmwReservation<'a>> {
    let role = match role {
        SigningRole::A => Participant::A,
        SigningRole::B => Participant::B,
    };
    let key = KeyScope {
        wallet: WalletScope {
            org: identifier("e2e")?,
            project: identifier("ml-dsa")?,
            environment: identifier("local")?,
            wallet: identifier("canonical-wallet")?,
        },
        key_id: identifier("near")?,
        epoch: 1,
        public_key_digest: Sha256::digest(public_key).into(),
        schedule_digest: Sha256::digest(
            schedules
                .iter()
                .flat_map(TrustedMlDsaSchedule::schedule_digest)
                .collect::<Vec<_>>(),
        )
        .into(),
    };
    let binding = sealing::Binding {
        key: key.clone(),
        role,
        batch: id,
        expires_at_ms: 100_000,
        wrapping_key_version: identifier("role-private-kek")?,
    };
    let mut wrapping = Zeroizing::new([0; 32]);
    getrandom::getrandom(wrapping.as_mut())?;
    let sealed = sealing::seal(prepared.into_storage(), &binding, &wrapping)?;
    let path = directory.join("prepared.sqlite");
    let db = Db::open(&path)?;
    tx(&db, pool::install_key(&db, key.clone()))?;
    tx(&db, pool::put(&db, binding, sealed, 1_000))?;
    drop(db); // The decoder cannot use the consumed in-memory preparation.
    let db = Db::open(&path)?;
    let request = SigningRequest {
        key,
        operation: [77; 32],
        message_digest: [78; 32],
        context_digest: [79; 32],
    };
    tx(&db, pool::reserve(&db, &request, &[id], 30_000, 1_001))?;
    let permit = Permit {
        request,
        expires_at_ms: 30_000,
        batches: vec![id],
    };
    let (binding, sealed) = tx(&db, pool::take(&db, role, &permit, id, 1_002))?;
    drop(db);
    let db = Db::open(&path)?;
    require(
        tx(&db, pool::take(&db, role, &permit, id, 1_003)).is_err(),
        "Consumed preparation reopened after restart",
    )?;
    let bytes = sealing::open(sealed, &binding, &wrapping)?;
    let role = match role {
        Participant::A => SigningRole::A,
        Participant::B => SigningRole::B,
    };
    let mut topologies = PublicTopologies::default();
    let restored = PreparedGmwReservation::from_consumed_storage(
        role,
        id,
        candidates,
        schedules,
        &mut topologies,
        bytes,
    )?;
    Ok(restored)
}
