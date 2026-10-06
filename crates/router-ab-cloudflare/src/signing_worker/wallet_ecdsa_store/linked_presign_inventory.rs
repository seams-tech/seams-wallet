use super::*;

pub const SIGNING_WORKER_LINKED_PRESIGN_INVENTORY_PATH_V1: &str =
    "/router-ab/signing-worker/wallet/linked-presign-inventory";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerLinkedPresignCursorV1 {
    Start,
    After { presign_session_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerLinkedPresignInventoryRequestV1 {
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub request: SigningWorkerRelocationRequestV1,
    pub cursor: SigningWorkerLinkedPresignCursorV1,
    pub limit: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerLinkedPresignIdentityV1 {
    presign_session_id: String,
    server_presignature_id: String,
    request_digest_hex: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerLinkedPresignInventoryPageV1 {
    Complete {
        sessions: Vec<SigningWorkerLinkedPresignIdentityV1>,
    },
    More {
        sessions: Vec<SigningWorkerLinkedPresignIdentityV1>,
        next_presign_session_id: String,
    },
}

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_linked_presign_sessions (
    presign_session_id TEXT PRIMARY KEY,
    server_presignature_id TEXT NOT NULL UNIQUE,
    owner_json TEXT NOT NULL,
    request_digest_hex TEXT NOT NULL,
    ownership_generation INTEGER NOT NULL CHECK (ownership_generation > 0))";

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LinkedPresignSessionRow {
    ownership_generation: u64,
    pub(super) presign_session_id: String,
    server_presignature_id: String,
    owner_json: String,
    request_digest_hex: String,
}

impl LinkedPresignSessionRow {
    pub(super) fn validate(&self, scope: &CloudflareSigningWorkerWalletScopeV1) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)?;
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
    pub fn list_relocating_linked_presign_sessions(
        &self,
        request: SigningWorkerLinkedPresignInventoryRequestV1,
    ) -> RouterAbProtocolResult<SigningWorkerLinkedPresignInventoryPageV1> {
        if !(1..=128).contains(&request.limit) {
            return Err(wallet_error(
                "Linked presign inventory limit must be 1 through 128",
            ));
        }
        self.require_linked_presign_move(&request.scope, &request.request)?;
        let after = match request.cursor {
            SigningWorkerLinkedPresignCursorV1::Start => String::new(),
            SigningWorkerLinkedPresignCursorV1::After { presign_session_id } => {
                crate::require_non_empty("Linked presign inventory cursor", &presign_session_id)?;
                presign_session_id
            }
        };
        let rows = self.sql.query::<LinkedPresignSessionRow>(
            "SELECT presign_session_id, server_presignature_id, owner_json, request_digest_hex, ownership_generation
             FROM wallet_linked_presign_sessions WHERE owner_json = ? AND ownership_generation = ? AND presign_session_id > ?
             ORDER BY presign_session_id LIMIT ?",
            vec![
                text(owner_json(
                    &request.scope,
                    "linked presign inventory",
                )?),
                SigningWorkerWalletSqlValueV1::Integer(request.request.source_generation as i64),
                text(after),
                SigningWorkerWalletSqlValueV1::Integer(i64::from(request.limit) + 1),
            ],
        )?;
        let more = rows.len() > request.limit as usize;
        let mut sessions = Vec::new();
        for row in rows.into_iter().take(request.limit as usize) {
            row.validate(&request.scope)?;
            sessions.push(SigningWorkerLinkedPresignIdentityV1 {
                presign_session_id: row.presign_session_id,
                server_presignature_id: row.server_presignature_id,
                request_digest_hex: row.request_digest_hex,
            });
        }
        if more {
            let last = sessions
                .last()
                .ok_or_else(|| wallet_error("Linked presign inventory page is empty"))?;
            let next_presign_session_id = last.presign_session_id.clone();
            Ok(SigningWorkerLinkedPresignInventoryPageV1::More { sessions, next_presign_session_id })
        } else {
            Ok(SigningWorkerLinkedPresignInventoryPageV1::Complete { sessions })
        }
    }

    pub fn authorize_linked_presign_fence(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        presign_session_id: &str,
        server_presignature_id: &str,
        request: &SigningWorkerRelocationRequestV1,
    ) -> RouterAbProtocolResult<String> {
        self.require_linked_presign_move(scope, request)?;
        let rows = self.sql.query::<LinkedPresignSessionRow>(
            "SELECT presign_session_id, server_presignature_id, owner_json, request_digest_hex, ownership_generation
             FROM wallet_linked_presign_sessions WHERE presign_session_id = ? AND server_presignature_id = ?",
            vec![text(presign_session_id.to_owned()), text(server_presignature_id.to_owned())],
        )?;
        let [row] = rows.as_slice() else {
            return Err(wallet_error(
                "Linked presign fence requires a registered session",
            ));
        };
        row.validate(scope)?;
        if row.ownership_generation != request.source_generation {
            return Err(wallet_error(
                "Linked presign source ownership generation differs",
            ));
        }
        Ok(row.request_digest_hex.clone())
    }

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
        let ownership_generation = self
            .execution_authority(&request.wallet_scope)?
            .ok_or_else(|| wallet_error("Linked presign execution authority is missing"))?
            .generation()?;
        let row = LinkedPresignSessionRow {
            ownership_generation,
            presign_session_id: request.presign_session_id.clone(),
            server_presignature_id: request.request.client_presignature_id.clone(),
            owner_json: owner_json(&request.wallet_scope, "linked presign inventory")?,
            request_digest_hex: hex_slice(&Sha256::digest(encoded)),
        };
        let prior = self.sql.query::<LinkedPresignSessionRow>(
            "SELECT presign_session_id, server_presignature_id, owner_json, request_digest_hex, ownership_generation
             FROM wallet_linked_presign_sessions WHERE presign_session_id = ? OR server_presignature_id = ?",
            vec![text(row.presign_session_id.clone()), text(row.server_presignature_id.clone())],
        )?;
        match prior.as_slice() {
            [] => self.insert_linked_presign_session(row),
            [stored] if stored == &row => Ok(()),
            _ => Err(replay_error("Linked presign inventory identity changed")),
        }
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
             (presign_session_id, server_presignature_id, owner_json, request_digest_hex, ownership_generation) VALUES (?, ?, ?, ?, ?)",
            vec![text(row.presign_session_id), text(row.server_presignature_id), text(row.owner_json), text(row.request_digest_hex), SigningWorkerWalletSqlValueV1::Integer(row.ownership_generation as i64)],
        )?;
        Ok(())
    }
}
