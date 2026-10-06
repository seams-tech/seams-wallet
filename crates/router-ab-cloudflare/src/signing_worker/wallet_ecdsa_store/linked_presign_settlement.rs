use super::*;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_linked_presign_relocation (
    owner_json TEXT NOT NULL,
    presign_session_id TEXT NOT NULL,
    move_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    PRIMARY KEY (owner_json, presign_session_id, move_id))";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerLinkedPresignRelocationRequestV1 {
    pub wallet_scope: CloudflareSigningWorkerWalletScopeV1,
    pub presign_session_id: String,
    pub server_presignature_id: String,
    pub request: SigningWorkerRelocationRequestV1,
}

impl SigningWorkerLinkedPresignRelocationRequestV1 {
    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        self.wallet_scope.validate()?;
        self.request.validate()?;
        crate::require_non_empty("Linked presign session", &self.presign_session_id)?;
        crate::require_non_empty("Linked server presignature", &self.server_presignature_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerLinkedPresignFreezeReceiptV1 {
    pub command: SigningWorkerLinkedPresignRelocationRequestV1,
    pub records_digest_hex: String,
    pub record_count: u64,
}

impl SigningWorkerLinkedPresignFreezeReceiptV1 {
    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        self.command.validate()?;
        if self.record_count == 0
            || self.records_digest_hex.len() != 64
            || !self
                .records_digest_hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(wallet_error("Linked presign freeze receipt is invalid"));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct ReceiptRow {
    receipt_json: String,
}

#[derive(Deserialize)]
struct PendingSessions {
    count: u64,
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    pub(super) fn require_linked_presign_move(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        request: &SigningWorkerRelocationRequestV1,
    ) -> RouterAbProtocolResult<()> {
        request.validate()?;
        match self.pool_fence(scope)? {
            Some(
                relocation::Fence::Draining { request: prior }
                | relocation::Fence::Invalidating { request: prior, .. },
            ) if prior == *request => Ok(()),
            Some(relocation::Fence::Frozen { receipt }) if receipt.request == *request => Ok(()),
            _ => Err(wallet_error(
                "Linked presign fence requires its source wallet move",
            )),
        }
    }

    /// The session host calls this only after its immutable snapshot commits.
    /// A lost acknowledgement is recovered by replaying the same session freeze.
    pub fn record_linked_presign_freeze(
        &self,
        receipt: SigningWorkerLinkedPresignFreezeReceiptV1,
    ) -> RouterAbProtocolResult<()> {
        receipt.validate()?;
        let command = &receipt.command;
        if let Some(prior) = self.read_linked_presign_freeze(command)? {
            return if prior == receipt {
                Ok(())
            } else {
                Err(replay_error(
                    "Linked presign freeze acknowledgement changed",
                ))
            };
        }
        self.authorize_linked_presign_fence(
            &command.wallet_scope,
            &command.presign_session_id,
            &command.server_presignature_id,
            &command.request,
        )?;
        let owner = owner_json(&command.wallet_scope, "linked presign settlement")?;
        let encoded =
            serde_json::to_string(&receipt).map_err(|error| wallet_error(error.to_string()))?;
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_linked_presign_relocation (owner_json, presign_session_id, move_id, receipt_json)
             VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
            vec![text(owner.clone()), text(command.presign_session_id.clone()), text(command.request.move_id.clone()), text(encoded.clone())],
        )?;
        match self.read_linked_presign_freeze(command)? {
            Some(stored) if stored == receipt => Ok(()),
            _ => Err(replay_error(
                "Linked presign freeze acknowledgement changed",
            )),
        }
    }

    fn read_linked_presign_freeze(
        &self,
        command: &SigningWorkerLinkedPresignRelocationRequestV1,
    ) -> RouterAbProtocolResult<Option<SigningWorkerLinkedPresignFreezeReceiptV1>> {
        let rows = self.sql.query::<ReceiptRow>(
            "SELECT receipt_json FROM wallet_linked_presign_relocation
             WHERE owner_json = ? AND presign_session_id = ? AND move_id = ?",
            vec![
                text(owner_json(
                    &command.wallet_scope,
                    "linked presign settlement",
                )?),
                text(command.presign_session_id.clone()),
                text(command.request.move_id.clone()),
            ],
        )?;
        match rows.as_slice() {
            [] => Ok(None),
            [row] => {
                let receipt: SigningWorkerLinkedPresignFreezeReceiptV1 =
                    serde_json::from_str(&row.receipt_json)
                        .map_err(|error| wallet_error(error.to_string()))?;
                receipt.validate()?;
                Ok(Some(receipt))
            }
            _ => Err(wallet_error(
                "Linked presign freeze acknowledgement is duplicated",
            )),
        }
    }

    pub(super) fn pending_linked_presign_sessions(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        request: &SigningWorkerRelocationRequestV1,
    ) -> RouterAbProtocolResult<u64> {
        let rows = self.sql.query::<PendingSessions>(
            "SELECT COUNT(*) AS count FROM wallet_linked_presign_sessions AS sessions
             WHERE sessions.owner_json = ? AND sessions.ownership_generation = ? AND NOT EXISTS (
                 SELECT 1 FROM wallet_linked_presign_relocation AS settled
                 WHERE settled.owner_json = sessions.owner_json
                   AND settled.presign_session_id = sessions.presign_session_id
                   AND settled.move_id = ?)",
            vec![
                text(owner_json(scope, "linked presign settlement")?),
                SigningWorkerWalletSqlValueV1::Integer(request.source_generation as i64),
                text(request.move_id.clone()),
            ],
        )?;
        match rows.as_slice() {
            [row] => Ok(row.count),
            _ => Err(wallet_error(
                "Linked presign settlement inventory is invalid",
            )),
        }
    }
}
