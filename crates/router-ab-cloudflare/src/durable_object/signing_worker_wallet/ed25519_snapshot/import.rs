use super::*;

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum ImportState {
    Prepared {
        source: SigningWorkerEd25519FenceCommandV1,
    },
    Receiving {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
        progress: ImportProgress,
    },
    Received {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Restoring {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
        progress: RestoreProgress,
    },
    Verified {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
    Activated {
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    },
}

impl ImportState {
    pub(super) fn source(&self) -> &SigningWorkerEd25519FenceCommandV1 {
        match self {
            Self::Prepared { source } => source,
            Self::Receiving { receipt, .. }
            | Self::Received { receipt }
            | Self::Restoring { receipt, .. }
            | Self::Verified { receipt }
            | Self::Activated { receipt } => &receipt.source,
        }
    }
    pub(super) fn require_receipt(
        &self,
        expected: &SigningWorkerEd25519SnapshotReceiptV1,
    ) -> Result<(), RouterAbProtocolError> {
        let matches = match self {
            Self::Prepared { source } => *source == expected.source,
            Self::Receiving { receipt, .. }
            | Self::Received { receipt }
            | Self::Restoring { receipt, .. }
            | Self::Verified { receipt }
            | Self::Activated { receipt } => receipt == expected,
        };
        if !matches {
            return Err(wallet_error("Ed25519 import receipt differs"));
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ImportProgress {
    next_segment: u32,
    position: SegmentPosition,
    digest_hex: String,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum SegmentPosition {
    RecordStart {
        record_index: u32,
    },
    RecordPart {
        record_index: u32,
        part_index: u32,
        part_count: u32,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RestoreProgress {
    pub next_segment: u32,
    pub next_record: u32,
    pub record_bytes_b64u: String,
    pub digest_hex: String,
}

#[derive(Deserialize)]
pub(super) struct ImportedSegmentRow {
    pub segment_json: String,
    pub acknowledgement_json: String,
}

#[derive(Deserialize)]
struct CountRow {
    count: u64,
}

pub(super) fn validate_receipt(
    receipt: &SigningWorkerEd25519SnapshotReceiptV1,
) -> Result<(), RouterAbProtocolError> {
    receipt.source.validate()?;
    if receipt.digest_hex.len() != 64
        || !receipt.digest_hex.bytes().all(is_hex_digit)
        || receipt.record_count > receipt.segment_count
        || (receipt.record_count == 0) != (receipt.segment_count == 0)
    {
        return Err(wallet_error("Ed25519 snapshot receipt is invalid"));
    }
    Ok(())
}

fn is_hex_digit(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

pub(super) fn segment_bytes(
    segment: &SigningWorkerEd25519SnapshotSegmentV1,
    receipt: &SigningWorkerEd25519SnapshotReceiptV1,
) -> Result<Vec<u8>, RouterAbProtocolError> {
    if segment.data_b64u.len() > (SEGMENT_BYTES * 4).div_ceil(3) {
        return Err(wallet_error(
            "Ed25519 import segment exceeds its byte bound",
        ));
    }
    let bytes = crate::decode_base64url_bytes_v1("Ed25519 import segment", &segment.data_b64u)?;
    if segment.segment_index >= receipt.segment_count
        || segment.record_index >= receipt.record_count
        || segment.part_count == 0
        || segment.part_count > receipt.segment_count
        || segment.part_index >= segment.part_count
        || bytes.is_empty()
        || bytes.len() > SEGMENT_BYTES
        || (segment.part_index + 1 != segment.part_count && bytes.len() != SEGMENT_BYTES)
    {
        return Err(wallet_error("Ed25519 import segment bounds are invalid"));
    }
    Ok(bytes)
}

impl RouterAbSigningWorkerWalletDurableObject {
    pub(super) fn read_ed25519_import(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> Result<Option<ImportState>, RouterAbProtocolError> {
        let owner = serde_json::to_string(scope).map_err(snapshot_encoding_error)?;
        let rows = self
            .sql
            .exec(
                "SELECT state_json FROM wallet_ed25519_import WHERE owner_json = ?",
                vec![SqlStorageValue::String(owner)],
            )
            .map_err(sql_error)?
            .to_array::<StateRow>()
            .map_err(sql_error)?;
        match rows.as_slice() {
            [] => Ok(None),
            [row] => serde_json::from_str(&row.state_json)
                .map(Some)
                .map_err(snapshot_encoding_error),
            _ => Err(wallet_error("Ed25519 import state is duplicated")),
        }
    }

    pub(super) fn save_ed25519_import(
        &self,
        state: &ImportState,
    ) -> Result<(), RouterAbProtocolError> {
        self.sql
            .exec(
                "INSERT INTO wallet_ed25519_import (owner_json, state_json) VALUES (?, ?)
            ON CONFLICT(owner_json) DO UPDATE SET state_json = excluded.state_json",
                vec![
                    SqlStorageValue::String(
                        serde_json::to_string(&state.source().scope)
                            .map_err(snapshot_encoding_error)?,
                    ),
                    SqlStorageValue::String(
                        serde_json::to_string(state).map_err(snapshot_encoding_error)?,
                    ),
                ],
            )
            .map_err(sql_error)?;
        Ok(())
    }

    pub(super) fn ed25519_inventory_count(&self) -> Result<u64, RouterAbProtocolError> {
        self.ed25519_count(
            "SELECT (SELECT COUNT(*) FROM wallet_registrations)
            + (SELECT COUNT(*) FROM wallet_retired_activations)
            + (SELECT COUNT(*) FROM wallet_linked_ed25519)
            + (SELECT COUNT(*) FROM wallet_round1) AS count",
        )
    }

    fn ed25519_count(&self, query: &str) -> Result<u64, RouterAbProtocolError> {
        let rows = self
            .sql
            .exec(query, None)
            .map_err(sql_error)?
            .to_array::<CountRow>()
            .map_err(sql_error)?;
        match rows.as_slice() {
            [row] => Ok(row.count),
            _ => Err(wallet_error("Ed25519 inventory count is invalid")),
        }
    }

    pub(super) fn prepare_ed25519_import(
        &self,
        source: SigningWorkerEd25519FenceCommandV1,
    ) -> Result<SigningWorkerEd25519SnapshotResponseV1, RouterAbProtocolError> {
        if let Some(state) = self.read_ed25519_import(&source.scope)? {
            if *state.source() != source {
                return Err(wallet_error("Ed25519 destination preparation changed"));
            }
            return Ok(SigningWorkerEd25519SnapshotResponseV1::Prepared { source });
        }
        let authority_count = self.ed25519_count(
            "SELECT (SELECT COUNT(*) FROM wallet_ed25519_execution)
            + (SELECT COUNT(*) FROM wallet_ed25519_relocation)
            + (SELECT COUNT(*) FROM wallet_ed25519_settlement)
            + (SELECT COUNT(*) FROM wallet_ed25519_snapshot) AS count",
        )?;
        if authority_count != 0 || self.ed25519_inventory_count()? != 0 {
            return Err(wallet_error("Ed25519 destination must be fresh and empty"));
        }
        self.sql
            .exec(
                "INSERT INTO wallet_ed25519_relocation (owner_json, request_json) VALUES (?, ?)",
                vec![
                    SqlStorageValue::String(
                        serde_json::to_string(&source.scope).map_err(snapshot_encoding_error)?,
                    ),
                    SqlStorageValue::String(
                        serde_json::to_string(&source.request).map_err(snapshot_encoding_error)?,
                    ),
                ],
            )
            .map_err(sql_error)?;
        self.save_ed25519_import(&ImportState::Prepared {
            source: source.clone(),
        })?;
        Ok(SigningWorkerEd25519SnapshotResponseV1::Prepared { source })
    }

    pub(super) fn read_ed25519_import_segment(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        segment_index: u32,
    ) -> Result<Option<ImportedSegmentRow>, RouterAbProtocolError> {
        let rows = self
            .sql
            .exec(
                "SELECT segment_json, acknowledgement_json FROM wallet_ed25519_import_segments
            WHERE owner_json = ? AND segment_index = ?",
                vec![
                    SqlStorageValue::String(
                        serde_json::to_string(scope).map_err(snapshot_encoding_error)?,
                    ),
                    SqlStorageValue::Integer(i64::from(segment_index)),
                ],
            )
            .map_err(sql_error)?
            .to_array::<ImportedSegmentRow>()
            .map_err(sql_error)?;
        let mut rows = rows.into_iter();
        let first = rows.next();
        if rows.next().is_some() {
            return Err(wallet_error("Ed25519 import segment is duplicated"));
        }
        Ok(first)
    }

    pub(super) fn import_ed25519_segment(
        &self,
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
        segment: SigningWorkerEd25519SnapshotSegmentV1,
    ) -> Result<SigningWorkerEd25519SnapshotResponseV1, RouterAbProtocolError> {
        validate_receipt(&receipt)?;
        segment_bytes(&segment, &receipt)?;
        let state = self
            .read_ed25519_import(&receipt.source.scope)?
            .ok_or_else(|| wallet_error("Ed25519 destination is not prepared"))?;
        state.require_receipt(&receipt)?;
        let encoded = serde_json::to_string(&segment).map_err(snapshot_encoding_error)?;
        if let Some(stored) =
            self.read_ed25519_import_segment(&receipt.source.scope, segment.segment_index)?
        {
            if stored.segment_json != encoded {
                return Err(wallet_error("Ed25519 import retry bytes changed"));
            }
            return serde_json::from_str(&stored.acknowledgement_json)
                .map_err(snapshot_encoding_error);
        }
        let mut progress = match state {
            ImportState::Prepared { .. } => ImportProgress {
                next_segment: 0,
                position: SegmentPosition::RecordStart { record_index: 0 },
                digest_hex: snapshot_digest(
                    &serde_json::to_vec(&receipt.source).map_err(snapshot_encoding_error)?,
                ),
            },
            ImportState::Receiving { progress, .. } => progress,
            _ => {
                return Err(wallet_error(
                    "Ed25519 destination no longer accepts new segments",
                ))
            }
        };
        let position_matches = match progress.position {
            SegmentPosition::RecordStart { record_index } => {
                segment.record_index == record_index && segment.part_index == 0
            }
            SegmentPosition::RecordPart {
                record_index,
                part_index,
                part_count,
            } => {
                segment.record_index == record_index
                    && segment.part_index == part_index
                    && segment.part_count == part_count
            }
        };
        if segment.segment_index != progress.next_segment || !position_matches {
            return Err(wallet_error("Ed25519 import segment is out of order"));
        }
        progress.next_segment += 1;
        progress.position = if segment.part_index + 1 == segment.part_count {
            SegmentPosition::RecordStart {
                record_index: segment.record_index + 1,
            }
        } else {
            SegmentPosition::RecordPart {
                record_index: segment.record_index,
                part_index: segment.part_index + 1,
                part_count: segment.part_count,
            }
        };
        progress.digest_hex = snapshot_digest(
            &serde_json::to_vec(&(&progress.digest_hex, &segment))
                .map_err(snapshot_encoding_error)?,
        );
        let state = if progress.next_segment == receipt.segment_count {
            if !matches!(progress.position, SegmentPosition::RecordStart { record_index } if record_index == receipt.record_count)
                || progress.digest_hex != receipt.digest_hex
            {
                return Err(wallet_error(
                    "Ed25519 received snapshot digest or record count differs",
                ));
            }
            ImportState::Received {
                receipt: receipt.clone(),
            }
        } else {
            ImportState::Receiving {
                receipt: receipt.clone(),
                progress,
            }
        };
        let response = SigningWorkerEd25519SnapshotResponseV1::Imported {
            segment_index: segment.segment_index,
            input_digest_hex: snapshot_digest(encoded.as_bytes()),
        };
        self.sql.exec("INSERT INTO wallet_ed25519_import_segments (owner_json, segment_index, segment_json, acknowledgement_json) VALUES (?, ?, ?, ?)",
            vec![SqlStorageValue::String(serde_json::to_string(&receipt.source.scope).map_err(snapshot_encoding_error)?),
                SqlStorageValue::Integer(i64::from(segment.segment_index)), SqlStorageValue::String(encoded),
                SqlStorageValue::String(serde_json::to_string(&response).map_err(snapshot_encoding_error)?)]).map_err(sql_error)?;
        self.save_ed25519_import(&state)?;
        Ok(response)
    }

    pub(super) fn activate_ed25519_import(
        &self,
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    ) -> Result<SigningWorkerEd25519SnapshotResponseV1, RouterAbProtocolError> {
        validate_receipt(&receipt)?;
        let state = self
            .read_ed25519_import(&receipt.source.scope)?
            .ok_or_else(|| wallet_error("Ed25519 destination is not prepared"))?;
        state.require_receipt(&receipt)?;
        let generation = receipt.source.request.source_generation + 1;
        if matches!(state, ImportState::Activated { .. }) {
            let sql = DurableObjectWalletSqlV1(&self.sql);
            crate::SigningWorkerEd25519ExecutionStoreV1::new(&sql)
                .require_generation(&receipt.source.scope, generation)?;
            return Ok(SigningWorkerEd25519SnapshotResponseV1::Activated { receipt });
        }
        if !matches!(state, ImportState::Verified { .. }) {
            return Err(wallet_error(
                "Ed25519 activation requires its verified destination",
            ));
        }
        let owner =
            serde_json::to_string(&receipt.source.scope).map_err(snapshot_encoding_error)?;
        self.sql.exec("INSERT INTO wallet_ed25519_execution (owner_json, ownership_generation) VALUES (?, ?)",
            vec![SqlStorageValue::String(owner.clone()), SqlStorageValue::Integer(i64::try_from(generation).map_err(|_| wallet_error("Ed25519 generation overflowed"))?)]).map_err(sql_error)?;
        let removed = self.sql.exec("DELETE FROM wallet_ed25519_relocation WHERE owner_json = ? AND request_json = ? RETURNING request_json AS state_json",
            vec![SqlStorageValue::String(owner), SqlStorageValue::String(serde_json::to_string(&receipt.source.request).map_err(snapshot_encoding_error)?)]).map_err(sql_error)?.to_array::<StateRow>().map_err(sql_error)?;
        if removed.len() != 1 {
            return Err(wallet_error("Ed25519 destination fence differs"));
        }
        self.save_ed25519_import(&ImportState::Activated {
            receipt: receipt.clone(),
        })?;
        Ok(SigningWorkerEd25519SnapshotResponseV1::Activated { receipt })
    }
}
