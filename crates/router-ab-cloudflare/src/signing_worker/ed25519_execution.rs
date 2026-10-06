use super::*;

pub const SIGNING_WORKER_ED25519_EXECUTION_SCHEMA_V1: &str =
    "CREATE TABLE IF NOT EXISTS wallet_ed25519_execution (
        owner_json TEXT PRIMARY KEY,
        ownership_generation INTEGER NOT NULL CHECK (ownership_generation > 0))";

/// Local execution authority, committed separately from transferable signing history.
pub struct SigningWorkerEd25519ExecutionStoreV1<'a, Sql> {
    pub(super) sql: &'a Sql,
}

#[derive(Deserialize)]
struct ExecutionRow {
    ownership_generation: u64,
}

impl<'a, Sql: SigningWorkerWalletSqlV1> SigningWorkerEd25519ExecutionStoreV1<'a, Sql> {
    pub fn new(sql: &'a Sql) -> Self {
        Self { sql }
    }

    /// The host commits this installation with a new initial registration.
    pub fn register(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        self.require_unfenced(scope)?;
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_ed25519_execution (owner_json, ownership_generation)
             VALUES (?, 1) ON CONFLICT(owner_json) DO NOTHING",
            vec![SigningWorkerWalletSqlValueV1::Text(execution_owner(scope)?)],
        )?;
        self.require_generation(scope, 1)
    }

    pub fn require_generation(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        generation: u64,
    ) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(generation)?;
        let rows = self.sql.query::<ExecutionRow>(
            "SELECT ownership_generation FROM wallet_ed25519_execution WHERE owner_json = ?",
            vec![SigningWorkerWalletSqlValueV1::Text(execution_owner(scope)?)],
        )?;
        match rows.as_slice() {
            [row] if row.ownership_generation == generation => Ok(()),
            [] => Err(execution_error("Ed25519 execution authority is missing")),
            [_] => Err(execution_error(
                "Ed25519 execution ownership generation differs",
            )),
            _ => Err(execution_error("Ed25519 execution authority is duplicated")),
        }
    }
}

pub(super) fn execution_owner(
    scope: &CloudflareSigningWorkerWalletScopeV1,
) -> RouterAbProtocolResult<String> {
    scope.validate()?;
    serde_json::to_string(scope).map_err(|error| execution_error(&error.to_string()))
}

pub(super) fn execution_error(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}
