use super::import::{segment_bytes, validate_receipt, ImportState, RestoreProgress};
use super::records::SnapshotRecord;
use super::*;

impl RouterAbSigningWorkerWalletDurableObject {
    pub(super) fn verify_ed25519_import(
        &self,
        receipt: SigningWorkerEd25519SnapshotReceiptV1,
    ) -> Result<SigningWorkerEd25519SnapshotResponseV1, RouterAbProtocolError> {
        validate_receipt(&receipt)?;
        let state = self
            .read_ed25519_import(&receipt.source.scope)?
            .ok_or_else(|| wallet_error("Ed25519 destination is not prepared"))?;
        state.require_receipt(&receipt)?;
        let mut progress = match state {
            ImportState::Verified { .. } | ImportState::Activated { .. } => {
                return Ok(SigningWorkerEd25519SnapshotResponseV1::Verified { receipt });
            }
            ImportState::Restoring { progress, .. } => progress,
            ImportState::Received { .. } => initial_restore_progress(&receipt)?,
            ImportState::Prepared { .. } if receipt.segment_count == 0 => {
                initial_restore_progress(&receipt)?
            }
            _ => {
                return Err(wallet_error(
                    "Ed25519 snapshot has not been completely received",
                ))
            }
        };
        let mut record_bytes = if progress.record_bytes_b64u.is_empty() {
            Vec::new()
        } else {
            crate::decode_base64url_bytes_v1(
                "Ed25519 partial restore record",
                &progress.record_bytes_b64u,
            )?
        };
        for _ in 0..16 {
            if progress.next_segment == receipt.segment_count {
                break;
            }
            let stored = self
                .read_ed25519_import_segment(&receipt.source.scope, progress.next_segment)?
                .ok_or_else(|| wallet_error("Ed25519 staged snapshot segment is missing"))?;
            let segment: SigningWorkerEd25519SnapshotSegmentV1 =
                serde_json::from_str(&stored.segment_json).map_err(snapshot_encoding_error)?;
            let bytes = segment_bytes(&segment, &receipt)?;
            if segment.segment_index != progress.next_segment
                || segment.record_index != progress.next_record
            {
                return Err(wallet_error("Ed25519 staged snapshot order differs"));
            }
            record_bytes.extend_from_slice(&bytes);
            progress.digest_hex = snapshot_digest(
                &serde_json::to_vec(&(&progress.digest_hex, &segment))
                    .map_err(snapshot_encoding_error)?,
            );
            progress.next_segment += 1;
            if segment.part_index + 1 == segment.part_count {
                let record: SnapshotRecord =
                    serde_json::from_slice(&record_bytes).map_err(snapshot_encoding_error)?;
                if serde_json::to_vec(&record).map_err(snapshot_encoding_error)? != record_bytes {
                    return Err(wallet_error("Ed25519 snapshot record encoding differs"));
                }
                record.restore(self, &receipt.source.scope)?;
                progress.next_record += 1;
                record_bytes.clear();
            }
        }
        if progress.next_segment == receipt.segment_count {
            if !record_bytes.is_empty()
                || progress.next_record != receipt.record_count
                || progress.digest_hex != receipt.digest_hex
                || self.ed25519_inventory_count()? != u64::from(receipt.record_count)
            {
                return Err(wallet_error(
                    "Ed25519 restored snapshot digest or inventory differs",
                ));
            }
            self.save_ed25519_import(&ImportState::Verified {
                receipt: receipt.clone(),
            })?;
            return Ok(SigningWorkerEd25519SnapshotResponseV1::Verified { receipt });
        }
        progress.record_bytes_b64u = crate::encode_base64url_bytes_v1(&record_bytes);
        self.save_ed25519_import(&ImportState::Restoring { receipt, progress })?;
        Ok(SigningWorkerEd25519SnapshotResponseV1::Restoring)
    }
}

fn initial_restore_progress(
    receipt: &SigningWorkerEd25519SnapshotReceiptV1,
) -> Result<RestoreProgress, RouterAbProtocolError> {
    Ok(RestoreProgress {
        next_segment: 0,
        next_record: 0,
        record_bytes_b64u: String::new(),
        digest_hex: snapshot_digest(
            &serde_json::to_vec(&receipt.source).map_err(snapshot_encoding_error)?,
        ),
    })
}
