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

impl PresignAuthorityRow {
    pub(super) fn authority(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<CloudflareSigningWorkerEcdsaPresignAuthorityV1> {
        let authority: CloudflareSigningWorkerEcdsaPresignAuthorityV1 =
            serde_json::from_str(&self.authority_json)
                .map_err(|error| wallet_error(error.to_string()))?;
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
        Ok(authority)
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
            authority_json: serde_json::to_string(&request.authority)
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
        let authority = row.authority(scope)?;
        if row.ceremony_expires_at_ms as u64 <= now_unix_ms {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::ExpiredLocalRequest,
                "Presign authority expired",
            ));
        }
        Ok(authority)
    }

    pub(super) fn restore_presign_authority(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        row: PresignAuthorityRow,
    ) -> RouterAbProtocolResult<()> {
        row.authority(scope)?;
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
