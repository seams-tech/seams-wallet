use super::*;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS signing_worker_presign_authorities (
    presign_session_id TEXT PRIMARY KEY,
    authority_json TEXT NOT NULL,
    ceremony_expires_at_ms INTEGER NOT NULL)";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PresignAuthorityRow {
    pub(super) presign_session_id: String,
    authority_json: String,
    #[serde(with = "sql_integer")]
    ceremony_expires_at_ms: i64,
}

// Older persisted authorities remain history, but cannot resume protocol work.
#[derive(Serialize, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
enum StoredPresignAuthority {
    Bound {
        ownership_generation: u64,
        authority: CloudflareSigningWorkerEcdsaPresignAuthorityV1,
    },
    Historical(CloudflareSigningWorkerEcdsaPresignAuthorityV1),
}

impl StoredPresignAuthority {
    fn authority(&self) -> &CloudflareSigningWorkerEcdsaPresignAuthorityV1 {
        match self {
            Self::Bound { authority, .. } | Self::Historical(authority) => authority,
        }
    }
}

impl PresignAuthorityRow {
    pub(super) fn authority(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPresignAuthorityV1> {
        Ok(self.decode(scope)?.authority().clone())
    }

    fn decode(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<StoredPresignAuthority> {
        let stored: StoredPresignAuthority = serde_json::from_str(&self.authority_json)
            .map_err(|error| wallet_error(error.to_string()))?;
        if let StoredPresignAuthority::Bound {
            ownership_generation,
            ..
        } = &stored
        {
            crate::router_wallet::validate_wallet_ownership_generation(*ownership_generation)?;
        }
        let authority = stored.authority();
        authority.wallet_scope().validate()?;
        if authority.wallet_scope() != scope || self.ceremony_expires_at_ms <= 0 {
            return Err(wallet_error(
                "Presign authority owner or expiry is inconsistent",
            ));
        }
        validate_presign_session_identity(
            &self.presign_session_id,
            self.ceremony_expires_at_ms as u64,
        )?;
        Ok(stored)
    }
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    /// Checks the pinned identity and current wallet fence before a protocol step.
    pub fn admit_presign_step(
        &self,
        request: &CloudflareSigningWorkerEcdsaPresignSessionStepRequestV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<()> {
        request.validate_at(now_unix_ms)?;
        let pinned = self.load_presign_authority(
            request.authority.wallet_scope(),
            &request.presign_session_id,
            now_unix_ms,
        )?;
        if request.authority != pinned {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::MalformedWirePayload,
                "SigningWorker ECDSA presign authority does not match initialized session",
            ));
        }
        self.require_mutation_admission(pinned.wallet_scope())
    }

    /// Claims an identity inside the same host transaction as material admission.
    pub fn claim_presign_authority(
        &self,
        request: &CloudflareSigningWorkerEcdsaPresignSessionInitRequestV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<()> {
        request.validate_at(now_unix_ms)?;
        self.require_mutation_admission(request.authority.wallet_scope())?;
        let row = PresignAuthorityRow {
            presign_session_id: request.presign_session_id.clone(),
            authority_json: serde_json::to_string(&StoredPresignAuthority::Bound {
                ownership_generation: self
                    .execution_authority(request.authority.wallet_scope())?
                    .ok_or_else(|| wallet_error("Presign execution authority is missing"))?
                    .generation()?,
                authority: request.authority.clone(),
            })
            .map_err(|error| wallet_error(error.to_string()))?,
            ceremony_expires_at_ms: i64::try_from(request.ceremony_expires_at_ms)
                .map_err(|_| wallet_error("Presign expiry exceeds SQL integer range"))?,
        };
        self.insert_presign_authority(row)
    }

    pub fn load_presign_authority(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        presign_session_id: &str,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPresignAuthorityV1> {
        scope.validate()?;
        let rows = self.sql.query::<PresignAuthorityRow>(
            "SELECT presign_session_id, authority_json,
                    CAST(ceremony_expires_at_ms AS TEXT) AS ceremony_expires_at_ms
             FROM signing_worker_presign_authorities WHERE presign_session_id = ?",
            vec![text(presign_session_id.to_owned())],
        )?;
        let [row] = rows.as_slice() else {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "Presign authority is unavailable",
            ));
        };
        let stored = row.decode(scope)?;
        match &stored {
            StoredPresignAuthority::Bound {
                ownership_generation,
                ..
            } => {
                self.require_execution_generation(scope, *ownership_generation)?;
            }
            StoredPresignAuthority::Historical(_) => {
                return Err(wallet_error(
                    "Historical presign authority cannot resume protocol work",
                ));
            }
        }
        if row.ceremony_expires_at_ms as u64 <= now_unix_ms {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "Presign authority expired",
            ));
        }
        Ok(stored.authority().clone())
    }

    pub(super) fn restore_presign_authority(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        source_generation: u64,
        row: PresignAuthorityRow,
    ) -> RouterAbProtocolResult<()> {
        if let StoredPresignAuthority::Bound {
            ownership_generation,
            ..
        } = row.decode(scope)?
        {
            if ownership_generation > source_generation {
                return Err(wallet_error(
                    "Imported presign authority exceeds its source generation",
                ));
            }
        }
        self.insert_presign_authority(row)
    }

    fn insert_presign_authority(&self, row: PresignAuthorityRow) -> RouterAbProtocolResult<()> {
        let inserted = self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO signing_worker_presign_authorities
             (presign_session_id, authority_json, ceremony_expires_at_ms)
             VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING presign_session_id",
            vec![
                text(row.presign_session_id),
                text(row.authority_json),
                SigningWorkerWalletSqlValueV1::Integer(row.ceremony_expires_at_ms),
            ],
        )?;
        if inserted.len() != 1 {
            return Err(replay_error("Presign identity was already initialized"));
        }
        Ok(())
    }
}
