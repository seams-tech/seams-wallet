use super::ed25519_execution::{execution_error, execution_owner};
use super::*;

pub const SIGNING_WORKER_ED25519_FENCE_PATH_V1: &str =
    "/router-ab/signing-worker/wallet/ed25519/fence";

pub const SIGNING_WORKER_ED25519_FENCE_SCHEMA_V1: &str =
    "CREATE TABLE IF NOT EXISTS wallet_ed25519_relocation (
        owner_json TEXT PRIMARY KEY,
        request_json TEXT NOT NULL)";

pub const SIGNING_WORKER_ED25519_SETTLE_PATH_V1: &str =
    "/router-ab/signing-worker/wallet/ed25519/settle";

pub const SIGNING_WORKER_ED25519_SETTLEMENT_SCHEMA_V1: &str =
    "CREATE TABLE IF NOT EXISTS wallet_ed25519_settlement (
        owner_json TEXT PRIMARY KEY,
        request_json TEXT NOT NULL)";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum SigningWorkerEd25519SettlementV1 {
    Draining {
        pending_rounds: u64,
    },
    Settled {
        command: SigningWorkerEd25519FenceCommandV1,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SigningWorkerEd25519FenceCommandV1 {
    pub scope: CloudflareSigningWorkerWalletScopeV1,
    pub request: SigningWorkerRelocationRequestV1,
}

impl SigningWorkerEd25519FenceCommandV1 {
    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        self.scope.validate()?;
        self.request.validate()
    }
}

#[derive(Deserialize)]
struct FenceRow {
    request_json: String,
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerEd25519ExecutionStoreV1<'_, Sql> {
    /// Closes new preparation. Already admitted finalization can still settle.
    /// The host commits this command in the same transaction domain as signing.
    pub fn fence(
        &self,
        command: SigningWorkerEd25519FenceCommandV1,
    ) -> RouterAbProtocolResult<SigningWorkerEd25519FenceCommandV1> {
        command.validate()?;
        self.require_generation(&command.scope, command.request.source_generation)?;
        let encoded = serde_json::to_string(&command.request)
            .map_err(|error| execution_error(&error.to_string()))?;
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_ed25519_relocation (owner_json, request_json)
             VALUES (?, ?) ON CONFLICT(owner_json) DO NOTHING",
            vec![
                SigningWorkerWalletSqlValueV1::Text(execution_owner(&command.scope)?),
                SigningWorkerWalletSqlValueV1::Text(encoded),
            ],
        )?;
        if self.read_fence(&command.scope)?.as_ref() != Some(&command.request) {
            return Err(execution_error("Ed25519 relocation inputs changed"));
        }
        Ok(command)
    }

    /// The host counts pending rounds in the same transaction that commits this fence.
    /// Expired unclaimed preparations do not block settlement.
    pub fn settle(
        &self,
        command: SigningWorkerEd25519FenceCommandV1,
        pending_rounds: u64,
    ) -> RouterAbProtocolResult<SigningWorkerEd25519SettlementV1> {
        self.fence(command.clone())?;
        if let Some(request) = self.read_settlement(&command.scope)? {
            if request != command.request {
                return Err(execution_error("Ed25519 settlement inputs changed"));
            }
            return Ok(SigningWorkerEd25519SettlementV1::Settled { command });
        }
        if pending_rounds != 0 {
            return Ok(SigningWorkerEd25519SettlementV1::Draining { pending_rounds });
        }
        let encoded = serde_json::to_string(&command.request)
            .map_err(|error| execution_error(&error.to_string()))?;
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_ed25519_settlement (owner_json, request_json) VALUES (?, ?)",
            vec![
                SigningWorkerWalletSqlValueV1::Text(execution_owner(&command.scope)?),
                SigningWorkerWalletSqlValueV1::Text(encoded),
            ],
        )?;
        Ok(SigningWorkerEd25519SettlementV1::Settled { command })
    }

    pub fn require_settlement(
        &self,
        command: &SigningWorkerEd25519FenceCommandV1,
    ) -> RouterAbProtocolResult<()> {
        command.validate()?;
        self.require_generation(&command.scope, command.request.source_generation)?;
        if self.read_fence(&command.scope)?.as_ref() != Some(&command.request)
            || self.read_settlement(&command.scope)?.as_ref() != Some(&command.request)
        {
            return Err(execution_error(
                "Ed25519 snapshot requires its settled source move",
            ));
        }
        Ok(())
    }

    pub fn require_finalization_admission(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        if self.read_settlement(scope)?.is_some() {
            return Err(execution_error("Ed25519 source signing has settled"));
        }
        Ok(())
    }

    fn read_settlement(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<Option<SigningWorkerRelocationRequestV1>> {
        let rows = self.sql.query::<FenceRow>(
            "SELECT request_json FROM wallet_ed25519_settlement WHERE owner_json = ?",
            vec![SigningWorkerWalletSqlValueV1::Text(execution_owner(scope)?)],
        )?;
        decode_relocation_request(&rows)
    }

    pub fn require_unfenced(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<()> {
        if self.read_fence(scope)?.is_some() {
            return Err(RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::LifecycleTransitionInProgress,
                "Wallet relocation has closed new Ed25519 work",
            ));
        }
        Ok(())
    }

    fn read_fence(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<Option<SigningWorkerRelocationRequestV1>> {
        let rows = self.sql.query::<FenceRow>(
            "SELECT request_json FROM wallet_ed25519_relocation WHERE owner_json = ?",
            vec![SigningWorkerWalletSqlValueV1::Text(execution_owner(scope)?)],
        )?;
        decode_relocation_request(&rows)
    }
}

fn decode_relocation_request(
    rows: &[FenceRow],
) -> RouterAbProtocolResult<Option<SigningWorkerRelocationRequestV1>> {
    match rows {
        [] => Ok(None),
        [row] => {
            let request: SigningWorkerRelocationRequestV1 = serde_json::from_str(&row.request_json)
                .map_err(|error| execution_error(&error.to_string()))?;
            request.validate()?;
            Ok(Some(request))
        }
        _ => Err(execution_error("Ed25519 relocation state is duplicated")),
    }
}
