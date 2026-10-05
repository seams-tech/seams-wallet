use super::*;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_linked_presign_sessions (
    presign_session_id TEXT PRIMARY KEY,
    server_presignature_id TEXT NOT NULL UNIQUE,
    owner_json TEXT NOT NULL,
    request_digest_hex TEXT NOT NULL)";

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LinkedPresignSessionRow {
    presign_session_id: String,
    server_presignature_id: String,
    owner_json: String,
    request_digest_hex: String,
}

impl LinkedPresignSessionRow {
    fn validate(&self, scope: &CloudflareSigningWorkerWalletScopeV1) -> RouterAbProtocolResult<()> {
        crate::require_non_empty("Linked presign session", &self.presign_session_id)?;
        crate::require_non_empty("Linked server presignature", &self.server_presignature_id)?;
        if self.owner_json != owner_json(scope, "linked presign inventory")?
            || self.request_digest_hex.len() != 64
            || !self
                .request_digest_hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(wallet_error(
                "Linked presign inventory owner or digest differs",
            ));
        }
        Ok(())
    }
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    /// Records discovery before the session object can create protocol state.
    pub fn register_linked_presign_session(
        &self,
        request: &crate::CloudflareSigningWorkerLinkedDeviceEcdsaPresignSessionInitRequestV1,
        now_unix_ms: u64,
    ) -> RouterAbProtocolResult<()> {
        request.validate_at(now_unix_ms)?;
        self.require_mutation_admission(&request.wallet_scope)?;
        let encoded =
            serde_json::to_vec(request).map_err(|error| wallet_error(error.to_string()))?;
        let row = LinkedPresignSessionRow {
            presign_session_id: request.presign_session_id.clone(),
            server_presignature_id: request.request.client_presignature_id.clone(),
            owner_json: owner_json(&request.wallet_scope, "linked presign inventory")?,
            request_digest_hex: hex_slice(&Sha256::digest(encoded)),
        };
        let prior = self.sql.query::<LinkedPresignSessionRow>(
            "SELECT presign_session_id, server_presignature_id, owner_json, request_digest_hex
             FROM wallet_linked_presign_sessions WHERE presign_session_id = ? OR server_presignature_id = ?",
            vec![text(row.presign_session_id.clone()), text(row.server_presignature_id.clone())],
        )?;
        match prior.as_slice() {
            [] => self.insert_linked_presign_session(row),
            [stored] if stored == &row => Ok(()),
            _ => Err(replay_error("Linked presign inventory identity changed")),
        }
    }

    pub(super) fn linked_presign_inventory(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<Vec<LinkedPresignSessionRow>> {
        let rows = self.sql.query::<LinkedPresignSessionRow>(
            "SELECT presign_session_id, server_presignature_id, owner_json, request_digest_hex
             FROM wallet_linked_presign_sessions WHERE owner_json = ? ORDER BY presign_session_id",
            vec![text(owner_json(scope, "linked presign inventory")?)],
        )?;
        for row in &rows {
            row.validate(scope)?;
        }
        Ok(rows)
    }

    pub(super) fn restore_linked_presign_inventory(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        rows: Vec<LinkedPresignSessionRow>,
    ) -> RouterAbProtocolResult<()> {
        for row in rows {
            row.validate(scope)?;
            self.insert_linked_presign_session(row)?;
        }
        Ok(())
    }

    fn insert_linked_presign_session(
        &self,
        row: LinkedPresignSessionRow,
    ) -> RouterAbProtocolResult<()> {
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_linked_presign_sessions
             (presign_session_id, server_presignature_id, owner_json, request_digest_hex) VALUES (?, ?, ?, ?)",
            vec![text(row.presign_session_id), text(row.server_presignature_id), text(row.owner_json), text(row.request_digest_hex)],
        )?;
        Ok(())
    }
}
