use super::*;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(in crate::signing_worker::wallet_ecdsa_store) struct RestoreCursor {
    pub position: u64,
    pub restored: u64,
    pub digest: [u8; 32],
    pub previous: Option<(u8, String)>,
}

impl RestoreCursor {
    pub(in crate::signing_worker::wallet_ecdsa_store) fn new() -> Self {
        Self {
            position: 0,
            restored: 0,
            digest: initial_digest(),
            previous: None,
        }
    }
}

impl SnapshotRecord {
    fn identity(&self) -> (u8, &str) {
        match self {
            Self::Pool(row) => (0, &row.pool_key),
            Self::Activation(row) => (1, &row.material_key),
            Self::LinkedReservation(row) => (2, &row.record_key),
            Self::Effect(row) => (3, &row.operation_key),
            Self::PresignAuthority(row) => (4, &row.presign_session_id),
            Self::LinkedPresignSession(row) => (5, &row.presign_session_id),
        }
    }

    fn restore<Sql: SigningWorkerWalletSqlV1>(
        self,
        store: &SigningWorkerWalletEcdsaStoreV1<'_, Sql>,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        match self {
            Self::Pool(row) => store.restore_pool_record(scope, row),
            Self::Activation(row) => store.restore_activation_record(scope, row),
            Self::LinkedReservation(row) => store.restore_linked_reservation(scope, row),
            Self::Effect(row) => store.restore_effect_record(scope, row),
            Self::PresignAuthority(row) => store.restore_presign_authority(scope, row),
            Self::LinkedPresignSession(row) => store.restore_linked_presign_session(scope, row),
        }
    }
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    // Restored rows and this cursor commit in the host's same storage transaction.
    pub(in crate::signing_worker::wallet_ecdsa_store) fn restore_ecdsa_batch(
        &self,
        receipt: &SigningWorkerPoolFreezeReceiptV1,
        reader: &mut super::super::import::stream::ChunkReader<'_, Sql>,
        cursor: &mut RestoreCursor,
    ) -> RouterAbProtocolResult<bool> {
        if cursor.position == 0 {
            let line = reader
                .record()?
                .ok_or_else(|| wallet_error("ECDSA snapshot header is missing"))?;
            let header: (
                CloudflareSigningWorkerWalletScopeV1,
                SigningWorkerRelocationRequestV1,
            ) = serde_json::from_slice(&line).map_err(|error| wallet_error(error.to_string()))?;
            if header.0 != receipt.scope || header.1 != receipt.request {
                return Err(wallet_error(
                    "ECDSA staged inventory binding differs from source",
                ));
            }
            require_canonical(&header, &line)?;
            cursor.digest = extend_digest(&cursor.digest, &line);
            cursor.position = reader.position();
        }
        for _ in 0..16 {
            let Some(line) = reader.record()? else {
                if cursor.restored != receipt.record_count
                    || hex_slice(&cursor.digest) != receipt.wallet_records_digest_hex
                {
                    return Err(wallet_error("ECDSA staged inventory differs from source"));
                }
                return Ok(true);
            };
            if cursor.restored >= receipt.record_count {
                return Err(wallet_error("ECDSA snapshot exceeds its record count"));
            }
            let row: SnapshotRecord =
                serde_json::from_slice(&line).map_err(|error| wallet_error(error.to_string()))?;
            require_canonical(&row, &line)?;
            let (family, key) = row.identity();
            if key.is_empty()
                || cursor
                    .previous
                    .as_ref()
                    .is_some_and(|(previous_family, previous_key)| {
                        family < *previous_family
                            || (family == *previous_family && key <= previous_key.as_str())
                    })
            {
                return Err(wallet_error("ECDSA snapshot record order differs"));
            }
            cursor.previous = Some((family, key.to_owned()));
            row.restore(self, &receipt.scope)?;
            cursor.digest = extend_digest(&cursor.digest, &line);
            cursor.restored += 1;
            cursor.position = reader.position();
        }
        Ok(false)
    }
}

fn require_canonical(value: &impl Serialize, line: &[u8]) -> RouterAbProtocolResult<()> {
    let canonical = serde_json::to_vec(value).map_err(|error| wallet_error(error.to_string()))?;
    if canonical != line {
        return Err(wallet_error("ECDSA snapshot record is not canonical"));
    }
    Ok(())
}
