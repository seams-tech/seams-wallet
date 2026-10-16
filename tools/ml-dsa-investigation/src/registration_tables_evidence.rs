//! Native adapter exercising the production table store with actual garbled frames.
use crate::{
    InvestigationResult,
    boolean_engine_evidence::run_ready,
    durable_preparation_evidence::{Db, identifier, tx},
    prepared_keygen_evidence::HostTransport,
    require,
};
use ed25519_yao::{
    ml_dsa_runtime::{
        RuntimeError, TrustedMlDsaSchedule,
        prepared::{Phase, Transport},
    },
    ml_dsa_signing::SigningRole,
};
use router_ab_cloudflare::ml_dsa::{
    self as m, Participant, Store, registration_preparation as preparation,
    registration_tables as tables,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

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
    pub(super) fn check_before_consume(&self) -> InvestigationResult<()> {
        if let Some((circuit, bytes)) = &self.first {
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
                        &self.seed,
                        3,
                    ),
                )
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
            tx(
                &self.db,
                tables::take(
                    &self.db,
                    &self.binding,
                    [52; 32],
                    *circuit,
                    0,
                    bytes.len(),
                    &self.seed,
                    3,
                ),
            )
            .is_err(),
            "Accepted an oversized table chunk count",
        )?;
        tx(&self.db, self.db.put(&record_name, &record))?;
        let name = format!(
            "registration-tables/{}/{}/1/ciphertext/0",
            hex::encode(self.binding.reservation),
            hex::encode(circuit)
        );
        let encoded: String = run_ready(self.db.get(&name))??.ok_or("Missing table ciphertext")?;
        let mut changed = encoded.clone().into_bytes();
        changed[0] = if changed[0] == b'A' { b'B' } else { b'A' };
        let changed = String::from_utf8(changed)?;
        tx(&self.db, self.db.put(&name, &changed))?;
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
                    &self.seed,
                    3,
                ),
            )
            .is_err(),
            "Opened modified second frame or failed to roll back first frame",
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
                tx(
                    &self.db,
                    tables::take(
                        &self.db,
                        &self.binding,
                        [52; 32],
                        *circuit,
                        0,
                        bytes.len(),
                        &self.seed,
                        3,
                    ),
                )
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
            "evaluator_negative_cases": if self.first.is_some() { vec!["before_consume", "wrong_ceremony", "wrong_key", "bounded_frame_chunks", "modified_later_frame_rolls_back_batch", "cached_order", "unserved_prefetch_replay_after_restart", "repeated_read", "retired_read", "retired_republish", "cancel_before_first_frame"] } else { vec![] }}),
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
