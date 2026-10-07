use super::*;
use crate::{
    SigningWorkerEd25519PreparationV1, SigningWorkerEd25519FenceCommandV1, SigningWorkerEd25519SnapshotCommandV1,
    SigningWorkerEd25519SnapshotReceiptV1, SigningWorkerEd25519SnapshotResponseV1,
    SigningWorkerEd25519SnapshotSegmentV1,
};
use sha2::{Digest, Sha256};
mod cleanup;
mod import;
mod records;
mod restore;
use records::{LinkedSnapshotRow, RegistrationSnapshotRow, RetiredSnapshotRow, SnapshotRow};

const SEGMENT_BYTES: usize = 4096;
pub(super) const IMPORT_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ed25519_import (
    owner_json TEXT PRIMARY KEY, state_json TEXT NOT NULL)";
pub(super) const IMPORT_SEGMENT_SCHEMA: &str =
    "CREATE TABLE IF NOT EXISTS wallet_ed25519_import_segments (
    owner_json TEXT NOT NULL, segment_index INTEGER NOT NULL,
    segment_json TEXT NOT NULL, acknowledgement_json TEXT NOT NULL,
    PRIMARY KEY (owner_json, segment_index))";

pub(super) const STATE_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ed25519_snapshot (
    owner_json TEXT PRIMARY KEY, state_json TEXT NOT NULL)";
pub(super) const SEGMENT_SCHEMA: &str =
    "CREATE TABLE IF NOT EXISTS wallet_ed25519_snapshot_segments (
    owner_json TEXT NOT NULL, segment_index INTEGER NOT NULL,
    segment_json TEXT NOT NULL, digest_hex TEXT NOT NULL,
    PRIMARY KEY (owner_json, segment_index))";

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum SnapshotState {
    Capturing {
        source: SigningWorkerEd25519FenceCommandV1,
        progress: CaptureProgress,
    },
    Frozen {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Cleaning {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Cleaned {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CaptureProgress {
    family: RecordFamily,
    after_key: String,
    record_count: u32,
    segment_count: u32,
    digest_hex: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RecordFamily {
    Registration,
    RetiredActivation,
    LinkedDevice,
    Round1,
    Complete,
}

impl RecordFamily {
    fn next(&self) -> Self {
        match self {
            Self::Registration => Self::RetiredActivation,
            Self::RetiredActivation => Self::LinkedDevice,
            Self::LinkedDevice => Self::Round1,
            Self::Round1 | Self::Complete => Self::Complete,
        }
    }
}

#[derive(Deserialize)]
struct StateRow {
    state_json: String,
}
#[derive(Deserialize)]
struct SegmentRow {
    segment_json: String,
    digest_hex: String,
}

impl RouterAbSigningWorkerWalletDurableObject {
    pub(super) fn ed25519_snapshot(
        &self,
        command: SigningWorkerEd25519SnapshotCommandV1,
    ) -> Result<Response, RouterAbProtocolError> {
        command.validate()?;
        let source = match &command {
            SigningWorkerEd25519SnapshotCommandV1::Capture { source } => Some(source),
            SigningWorkerEd25519SnapshotCommandV1::Export { receipt, .. } => Some(&receipt.source),
            _ => None,
        };
        if let Some(source) = source {
            let sql = DurableObjectWalletSqlV1(&self.sql);
            crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql).require_settlement(source)?;
        }
        let response = match command {
            SigningWorkerEd25519SnapshotCommandV1::Cleanup { activation } => {
                self.cleanup_ed25519_source(activation)?
            }
            SigningWorkerEd25519SnapshotCommandV1::Prepare { source } => {
                self.prepare_ed25519_import(source)?
            }
            SigningWorkerEd25519SnapshotCommandV1::Import { receipt, segment } => {
                self.import_ed25519_segment(receipt, segment)?
            }
            SigningWorkerEd25519SnapshotCommandV1::Status { receipt } => {
                self.ed25519_import_status(receipt)?
            }
            SigningWorkerEd25519SnapshotCommandV1::Verify { receipt } => {
                self.verify_ed25519_import(receipt)?
            }
            SigningWorkerEd25519SnapshotCommandV1::Activate { receipt } => {
                self.activate_ed25519_import(receipt)?
            }

            SigningWorkerEd25519SnapshotCommandV1::Capture { source } => {
                self.capture_ed25519_snapshot(source)?
            }
            SigningWorkerEd25519SnapshotCommandV1::Export {
                receipt,
                segment_index,
            } => self.export_ed25519_snapshot(receipt, segment_index)?,
        };
        Response::from_json(&response).map_err(sql_error)
    }

    fn read_ed25519_snapshot(
        &self,
        owner: &str,
    ) -> Result<Option<SnapshotState>, RouterAbProtocolError> {
        let rows = self
            .sql
            .exec(
                "SELECT state_json FROM wallet_ed25519_snapshot WHERE owner_json = ?",
                vec![SqlStorageValue::String(owner.to_owned())],
            )
            .map_err(sql_error)?
            .to_array::<StateRow>()
            .map_err(sql_error)?;
        match rows.as_slice() {
            [] => Ok(None),
            [row] => serde_json::from_str(&row.state_json)
                .map(Some)
                .map_err(snapshot_encoding_error),
            _ => Err(wallet_error("Ed25519 snapshot state is duplicated")),
        }
    }

    fn capture_ed25519_snapshot(
        &self,
        source: SigningWorkerEd25519FenceCommandV1,
    ) -> Result<SigningWorkerEd25519SnapshotResponseV1, RouterAbProtocolError> {
        let owner = serde_json::to_string(&source.scope).map_err(snapshot_encoding_error)?;
        let mut progress = match self.read_ed25519_snapshot(&owner)? {
            Some(SnapshotState::Frozen { receipt }) if receipt.source == source => {
                return Ok(SigningWorkerEd25519SnapshotResponseV1::Frozen { receipt });
            }
            Some(SnapshotState::Capturing {
                source: prior,
                progress,
            }) if prior == source => progress,
            Some(_) => return Err(wallet_error("Ed25519 snapshot move differs")),
            None => CaptureProgress {
                family: RecordFamily::Registration,
                after_key: String::new(),
                record_count: 0,
                segment_count: 0,
                digest_hex: snapshot_digest(
                    &serde_json::to_vec(&source).map_err(snapshot_encoding_error)?,
                ),
            },
        };
        match progress.family {
            RecordFamily::Registration => self.capture_ed25519_rows::<RegistrationSnapshotRow>(
                &source,
                &owner,
                &mut progress,
            )?,
            RecordFamily::RetiredActivation => {
                self.capture_ed25519_rows::<RetiredSnapshotRow>(&source, &owner, &mut progress)?
            }
            RecordFamily::LinkedDevice => {
                self.capture_ed25519_rows::<LinkedSnapshotRow>(&source, &owner, &mut progress)?
            }
            RecordFamily::Round1 => {
                self.capture_ed25519_rows::<Round1RowV1>(&source, &owner, &mut progress)?
            }
            RecordFamily::Complete => {}
        }
        let state = if matches!(progress.family, RecordFamily::Complete) {
            SnapshotState::Frozen {
                receipt: SigningWorkerEd25519SnapshotReceiptV1 {
                    source,
                    record_count: progress.record_count,
                    segment_count: progress.segment_count,
                    digest_hex: progress.digest_hex,
                },
            }
        } else {
            SnapshotState::Capturing { source, progress }
        };
        self.sql
            .exec(
                "INSERT INTO wallet_ed25519_snapshot (owner_json, state_json) VALUES (?, ?)
             ON CONFLICT(owner_json) DO UPDATE SET state_json = excluded.state_json",
                vec![
                    SqlStorageValue::String(owner),
                    SqlStorageValue::String(
                        serde_json::to_string(&state).map_err(snapshot_encoding_error)?,
                    ),
                ],
            )
            .map_err(sql_error)?;
        Ok(match state {
            SnapshotState::Cleaning { .. } | SnapshotState::Cleaned { .. } => {
                return Err(wallet_error("Ed25519 snapshot is being cleaned"));
            }
            SnapshotState::Capturing { .. } => SigningWorkerEd25519SnapshotResponseV1::Capturing,
            SnapshotState::Frozen { receipt } => {
                SigningWorkerEd25519SnapshotResponseV1::Frozen { receipt }
            }
        })
    }

    fn capture_ed25519_rows<Row: SnapshotRow>(
        &self,
        source: &SigningWorkerEd25519FenceCommandV1,
        owner: &str,
        progress: &mut CaptureProgress,
    ) -> Result<(), RouterAbProtocolError> {
        let rows = self
            .sql
            .exec(
                Row::SELECT,
                vec![SqlStorageValue::String(progress.after_key.clone())],
            )
            .map_err(sql_error)?
            .to_array::<Row>()
            .map_err(sql_error)?;
        let family_complete = rows.len() < 16;
        for row in rows {
            row.validate(self, &source.scope)?;
            progress.after_key = row.key().to_owned();
            let bytes = serde_json::to_vec(&row.into_record()).map_err(snapshot_encoding_error)?;
            let part_count = u32::try_from(bytes.len().div_ceil(SEGMENT_BYTES))
                .map_err(|_| wallet_error("Ed25519 snapshot record is too large"))?;
            for (part_index, part) in bytes.chunks(SEGMENT_BYTES).enumerate() {
                let segment = SigningWorkerEd25519SnapshotSegmentV1 {
                    segment_index: progress.segment_count,
                    record_index: progress.record_count,
                    part_index: part_index as u32,
                    part_count,
                    data_b64u: crate::encode_base64url_bytes_v1(part),
                };
                let encoded = serde_json::to_string(&segment).map_err(snapshot_encoding_error)?;
                self.sql
                    .exec(
                        "INSERT INTO wallet_ed25519_snapshot_segments
                     (owner_json, segment_index, segment_json, digest_hex) VALUES (?, ?, ?, ?)",
                        vec![
                            SqlStorageValue::String(owner.to_owned()),
                            SqlStorageValue::Integer(i64::from(segment.segment_index)),
                            SqlStorageValue::String(encoded.clone()),
                            SqlStorageValue::String(snapshot_digest(encoded.as_bytes())),
                        ],
                    )
                    .map_err(sql_error)?;
                progress.digest_hex = snapshot_digest(
                    &serde_json::to_vec(&(&progress.digest_hex, &segment))
                        .map_err(snapshot_encoding_error)?,
                );
                progress.segment_count = progress
                    .segment_count
                    .checked_add(1)
                    .ok_or_else(|| wallet_error("Ed25519 snapshot has too many segments"))?;
            }
            progress.record_count = progress
                .record_count
                .checked_add(1)
                .ok_or_else(|| wallet_error("Ed25519 snapshot has too many records"))?;
        }
        if family_complete {
            progress.family = progress.family.next();
            progress.after_key.clear();
        }
        Ok(())
    }

    fn export_ed25519_snapshot(
        &self,
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
        segment_index: u32,
    ) -> Result<SigningWorkerEd25519SnapshotResponseV1, RouterAbProtocolError> {
        let owner =
            serde_json::to_string(&receipt.source.scope).map_err(snapshot_encoding_error)?;
        match self.read_ed25519_snapshot(&owner)? {
            Some(SnapshotState::Frozen { receipt: stored }) if stored == receipt => {}
            _ => {
                return Err(wallet_error(
                    "Ed25519 export requires its frozen snapshot receipt",
                ))
            }
        }
        if segment_index >= receipt.segment_count {
            return Err(wallet_error("Ed25519 snapshot segment is absent"));
        }
        let rows = self.sql.exec(
            "SELECT segment_json, digest_hex FROM wallet_ed25519_snapshot_segments WHERE owner_json = ? AND segment_index = ?",
            vec![SqlStorageValue::String(owner), SqlStorageValue::Integer(i64::from(segment_index))],
        ).map_err(sql_error)?.to_array::<SegmentRow>().map_err(sql_error)?;
        let [row] = rows.as_slice() else {
            return Err(wallet_error("Ed25519 sealed snapshot segment is missing"));
        };
        if snapshot_digest(row.segment_json.as_bytes()) != row.digest_hex {
            return Err(wallet_error("Ed25519 sealed snapshot segment differs"));
        }
        let segment: SigningWorkerEd25519SnapshotSegmentV1 =
            serde_json::from_str(&row.segment_json).map_err(snapshot_encoding_error)?;
        let bytes =
            crate::decode_base64url_bytes_v1("Ed25519 snapshot segment", &segment.data_b64u)?;
        if segment.segment_index != segment_index || bytes.is_empty() || bytes.len() > SEGMENT_BYTES
        {
            return Err(wallet_error("Ed25519 snapshot segment binding differs"));
        }
        Ok(SigningWorkerEd25519SnapshotResponseV1::Segment { receipt, segment })
    }
}

fn snapshot_digest(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"seams/signing-worker/wallet-ed25519-snapshot/v1");
    digest.update(bytes);
    crate::ed25519_yao_lifecycle::role_d1::encode_hex_slice(&digest.finalize())
}

fn snapshot_encoding_error(error: serde_json::Error) -> RouterAbProtocolError {
    wallet_error(format!("Ed25519 snapshot encoding is invalid: {error}"))
}
