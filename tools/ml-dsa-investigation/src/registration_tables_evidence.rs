//! Native adapter exercising the production table store with actual garbled frames.
use crate::{
    InvestigationResult,
    boolean_engine_evidence::run_ready,
    durable_preparation_evidence::{Db, error as storage_error, identifier, tx},
    prepared_keygen_evidence::HostTransport,
    require,
};
use ml_dsa_threshold::{
    runtime::{
        RuntimeError, TrustedMlDsaSchedule,
        prepared::{Phase, Transport},
    },
    signing::SigningRole,
};
use router_ab_cloudflare::ml_dsa::{
    self as m, Participant, Store, registration_preparation as preparation,
    registration_tables as tables,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    cell::Cell,
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

/// Fails the second tombstone after production code has mutated the real database.
struct FailingConsume<'a> {
    db: &'a Db,
    fail_at: &'a str,
    deleted_chunks: Cell<usize>,
    consumed_frames: Cell<usize>,
    injected: Cell<bool>,
}
impl Store for FailingConsume<'_> {
    async fn get<T: DeserializeOwned>(&self, key: &str) -> m::Result<Option<T>> {
        self.db.get(key).await
    }
    async fn put<T: Serialize>(&self, key: &str, value: &T) -> m::Result<()> {
        if key == self.fail_at {
            self.injected.set(true);
            return Err(storage_error("Injected later tombstone failure"));
        }
        self.db.put(key, value).await?;
        self.consumed_frames.set(self.consumed_frames.get() + 1);
        Ok(())
    }
    async fn delete(&self, key: &str) -> m::Result<()> {
        self.db.delete(key).await?;
        self.deleted_chunks.set(self.deleted_chunks.get() + 1);
        Ok(())
    }
}

pub(super) struct RegistrationTransport {
    pub(super) inner: HostTransport,
    pub(super) binding: preparation::Binding,
    pub(super) seed: Zeroizing<[u8; 32]>,
    db: Db,
    database: PathBuf,
    first: Option<([u8; 32], Vec<u8>)>,
    frames_written: usize,
    frames_read: usize,
    replay_checked: bool,
    frames: Option<tables::ConsumedFrames>,
    read_transactions: usize,
    peak_cached_frames: usize,
}
impl RegistrationTransport {
    pub(super) fn new(
        inner: HostTransport,
        role: SigningRole,
        schedules: &[TrustedMlDsaSchedule<'_>],
        directory: &Path,
    ) -> InvestigationResult<Self> {
        let database = directory.join("registration-preparation.sqlite");
        let mut seed = Zeroizing::new([0; 32]);
        getrandom::getrandom(seed.as_mut())?;
        Ok(Self {
            inner,
            db: Db::open(&database)?,
            database,
            seed,
            binding: preparation::Binding {
                pool_scope: Sha256::digest(b"disposable-keygen-storage-e2e").into(),
                role: match role {
                    SigningRole::A => Participant::A,
                    SigningRole::B => Participant::B,
                },
                reservation: [51; 32],
                schedule_digest: m::execution::schedule_digest(schedules),
                expires_at_ms: 100_000,
                wrapping_key_version: identifier("test-keygen-1")?,
            },
            first: None,
            frames_written: 0,
            frames_read: 0,
            replay_checked: false,
            frames: None,
            read_transactions: 0,
            peak_cached_frames: 0,
        })
    }
    fn take_first_frames(
        &self,
        store: &impl Store,
        circuit: [u8; 32],
        length: usize,
    ) -> InvestigationResult<tables::ConsumedFrames> {
        tx(
            &self.db,
            tables::take(
                store,
                &self.binding,
                [52; 32],
                circuit,
                0,
                length,
                &self.seed,
                3,
            ),
        )
    }

    pub(super) fn check_before_consume(&self) -> InvestigationResult<()> {
        if let Some((circuit, bytes)) = &self.first {
            require(
                self.take_first_frames(&self.db, *circuit, bytes.len())
                    .is_err(),
                "Read table before registration consume",
            )?;
        }
        Ok(())
    }
    pub(super) fn check_after_consume(&mut self) -> InvestigationResult<()> {
        self.db = Db::open(&self.database)?;
        let Some((circuit, bytes)) = &self.first else {
            return Ok(());
        };
        require(
            tx(
                &self.db,
                tables::take(
                    &self.db,
                    &self.binding,
                    [53; 32],
                    *circuit,
                    0,
                    bytes.len(),
                    &self.seed,
                    3,
                ),
            )
            .is_err(),
            "Read table for another ceremony",
        )?;
        require(
            tx(
                &self.db,
                tables::take(
                    &self.db,
                    &self.binding,
                    [52; 32],
                    *circuit,
                    0,
                    bytes.len(),
                    &[0; 32],
                    3,
                ),
            )
            .is_err(),
            "Opened table with wrong wrapping key",
        )?;
        let record_name = format!(
            "registration-tables/{}/{}/0",
            hex::encode(self.binding.reservation),
            hex::encode(circuit)
        );
        let record: Value = run_ready(self.db.get(&record_name))??.ok_or("Missing frame record")?;
        let mut oversized = record.clone();
        oversized["chunks"] = json!(100);
        tx(&self.db, self.db.put(&record_name, &oversized))?;
        require(
            self.take_first_frames(&self.db, *circuit, bytes.len())
                .is_err(),
            "Accepted an oversized table chunk count",
        )?;
        tx(&self.db, self.db.put(&record_name, &record))?;
        let name = format!(
            "registration-tables/{}/{}/1/data/0",
            hex::encode(self.binding.reservation),
            hex::encode(circuit)
        );
        let encoded: Vec<u8> = run_ready(self.db.get(&name))??.ok_or("Missing table ciphertext")?;
        tx(&self.db, self.db.delete(&name))?;
        require(
            self.take_first_frames(&self.db, *circuit, bytes.len())
                .is_err(),
            "Accepted a missing later-frame chunk",
        )?;
        tx(&self.db, self.db.put(&name, &encoded))?;
        let second_frame = format!(
            "registration-tables/{}/{}/1",
            hex::encode(self.binding.reservation),
            hex::encode(circuit),
        );
        let before_chunks = self.db.remaining_registration_table_chunks()?;
        let failure = FailingConsume {
            db: &self.db,
            fail_at: &second_frame,
            deleted_chunks: Cell::new(0),
            consumed_frames: Cell::new(0),
            injected: Cell::new(false),
        };
        require(
            self.take_first_frames(&failure, *circuit, bytes.len())
                .is_err(),
            "Accepted an interrupted table consume",
        )?;
        require(
            failure.injected.get()
                && failure.deleted_chunks.get() > 0
                && failure.consumed_frames.get() == 1,
            "Consume fault did not follow chunk deletion and the first tombstone",
        )?;
        let reopened = Db::open(&self.database)?;
        require(
            reopened.remaining_registration_table_chunks()? == before_chunks
                && run_ready(reopened.get::<Value>(&record_name))?? == Some(record),
            "Interrupted table consume survived transaction rollback",
        )?;
        let mut changed = encoded.clone();
        changed[8] ^= 1;
        tx(&self.db, self.db.put(&name, &changed))?;
        require(
            self.take_first_frames(&self.db, *circuit, bytes.len())
                .is_err(),
            "Opened modified second frame",
        )?;
        tx(&self.db, self.db.put(&name, &encoded))?;
        Ok(())
    }
    pub(super) fn cleanup(&mut self) -> InvestigationResult<Value> {
        require(
            self.frames
                .as_ref()
                .is_none_or(|frames| frames.remaining() == 0),
            "Key generation left prefetched frames unused",
        )?;
        let mut steps = 0;
        while !tx(&self.db, tables::retire_next(&self.db, &self.binding))? {
            steps += 1;
        }
        require(
            tx(&self.db, tables::retire_next(&self.db, &self.binding))?,
            "Table cleanup retry failed",
        )?;
        require(
            self.db.remaining_registration_table_chunks()? == 0,
            "Cleanup retained table ciphertext",
        )?;
        if let Some((circuit, bytes)) = &self.first {
            require(
                self.take_first_frames(&self.db, *circuit, bytes.len())
                    .is_err(),
                "Read retired table",
            )?;
            let mut cancelled = self.binding.clone();
            cancelled.reservation = [54; 32];
            tx(
                &self.db,
                tables::put(&self.db, &cancelled, *circuit, 0, bytes, &self.seed, 1),
            )?;
            require(
                tx(&self.db, tables::retire_next(&self.db, &cancelled))?,
                "Small cancellation cleanup incomplete",
            )?;
            require(
                tx(
                    &self.db,
                    tables::put(&self.db, &cancelled, *circuit, 0, bytes, &self.seed, 2),
                )
                .is_err(),
                "Repopulated retired table reservation",
            )?;
            cancelled.reservation = [55; 32];
            require(
                tx(&self.db, tables::retire_next(&self.db, &cancelled))?,
                "Early cancellation incomplete",
            )?;
            require(
                tx(
                    &self.db,
                    tables::put(&self.db, &cancelled, *circuit, 0, bytes, &self.seed, 2),
                )
                .is_err(),
                "Late writer recreated early-cancelled reservation",
            )?;
            require(self.replay_checked, "Table replay check did not execute")?;
        }
        Ok(
            json!({"role":self.binding.role,"frames_written":self.frames_written,"frames_read":self.frames_read,
            "read_transactions":self.read_transactions,"peak_cached_frames":self.peak_cached_frames,
            "cleanup_steps":steps+1,"cleanup_complete":true,"remaining_ciphertext_chunks":self.db.remaining_registration_table_chunks()?,"replay_checked":self.replay_checked,
            "evaluator_negative_cases": if self.first.is_some() { vec!["invalid_later_write_rolls_back_batch", "before_consume", "wrong_ceremony", "wrong_key", "bounded_frame_chunks", "missing_later_frame_chunk", "consume_write_failure_rollback", "modified_later_frame", "cached_order", "unserved_prefetch_replay_after_restart", "repeated_read", "retired_read", "retired_republish", "cancel_before_first_frame"] } else { vec![] }}),
        )
    }
}
fn failure(_: impl core::fmt::Display) -> RuntimeError {
    RuntimeError::TableFrame
}
impl Transport for RegistrationTransport {
    async fn send(&mut self, bytes: &[u8]) -> Result<(), RuntimeError> {
        self.inner.send(bytes).await
    }
    async fn receive(&mut self, length: usize) -> Result<Vec<u8>, RuntimeError> {
        self.inner.receive(length).await
    }
    async fn store(
        &mut self,
        circuit: [u8; 32],
        ordinal: usize,
        bytes: &[u8],
    ) -> Result<(), RuntimeError> {
        if self.first.is_none() {
            let failed_batch = tx(&self.db, async {
                tables::put(
                    &self.db,
                    &self.binding,
                    circuit,
                    ordinal,
                    bytes,
                    &self.seed,
                    1,
                )
                .await?;
                tables::put(
                    &self.db,
                    &self.binding,
                    circuit,
                    ordinal + 2,
                    bytes,
                    &self.seed,
                    1,
                )
                .await
            });
            require(
                failed_batch.is_err(),
                "Out-of-order later write was accepted",
            )
            .map_err(failure)?;
            require(
                self.db
                    .remaining_registration_table_chunks()
                    .map_err(failure)?
                    == 0,
                "Failed write batch retained its earlier frame",
            )
            .map_err(failure)?;
        }
        tx(
            &self.db,
            tables::put(
                &self.db,
                &self.binding,
                circuit,
                ordinal,
                bytes,
                &self.seed,
                1,
            ),
        )
        .map_err(failure)?;
        if self.first.is_none() {
            self.first = Some((circuit, bytes.to_vec()));
        }
        self.frames_written += 1;
        self.inner.counts[0].table_write(bytes.len());
        Ok(())
    }
    async fn load(
        &mut self,
        circuit: [u8; 32],
        ordinal: usize,
        length: usize,
    ) -> Result<Vec<u8>, RuntimeError> {
        if self
            .frames
            .as_ref()
            .is_none_or(|frames| frames.remaining() == 0)
        {
            let frames = tx(
                &self.db,
                tables::take(
                    &self.db,
                    &self.binding,
                    [52; 32],
                    circuit,
                    ordinal,
                    length,
                    &self.seed,
                    3,
                ),
            )
            .map_err(failure)?;
            self.peak_cached_frames = self.peak_cached_frames.max(frames.remaining());
            self.read_transactions += 1;
            self.frames = Some(frames);
        }
        if !self.replay_checked {
            let frames = self.frames.as_mut().ok_or(RuntimeError::TableFrame)?;
            if frames.remaining() < 2 || frames.next(circuit, ordinal + 1, length).is_ok() {
                return Err(RuntimeError::SessionBinding);
            }
            let reopened = Db::open(&self.database).map_err(failure)?;
            for already_consumed in [ordinal, ordinal + 1] {
                if tx(
                    &reopened,
                    tables::take(
                        &reopened,
                        &self.binding,
                        [52; 32],
                        circuit,
                        already_consumed,
                        length,
                        &self.seed,
                        3,
                    ),
                )
                .is_ok()
                {
                    return Err(RuntimeError::SessionBinding);
                }
            }
            self.replay_checked = true;
        }
        let bytes = self
            .frames
            .as_mut()
            .ok_or(RuntimeError::TableFrame)?
            .next(circuit, ordinal, length)
            .map_err(failure)?;
        self.frames_read += 1;
        self.inner.counts[1].table_read(length);
        Ok(bytes)
    }
    fn phase(&mut self, phase: Phase) {
        self.inner.phase(phase);
    }
}
