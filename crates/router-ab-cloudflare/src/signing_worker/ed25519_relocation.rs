use super::ed25519_execution::{execution_error, execution_owner};
use super::*;

pub const SIGNING_WORKER_ED25519_FENCE_PATH_V1: &str =
    "/router-ab/signing-worker/wallet/ed25519/fence";

pub const SIGNING_WORKER_ED25519_FENCE_SCHEMA_V1: &str =
    "CREATE TABLE IF NOT EXISTS wallet_ed25519_relocation (
        owner_json TEXT PRIMARY KEY,
        request_json TEXT NOT NULL)";

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
        match rows.as_slice() {
            [] => Ok(None),
            [row] => {
                let request: SigningWorkerRelocationRequestV1 =
                    serde_json::from_str(&row.request_json)
                        .map_err(|error| execution_error(&error.to_string()))?;
                request.validate()?;
                Ok(Some(request))
            }
            _ => Err(execution_error("Ed25519 relocation fence is duplicated")),
        }
    }
}
