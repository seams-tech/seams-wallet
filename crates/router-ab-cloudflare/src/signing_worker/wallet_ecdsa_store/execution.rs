use super::*;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS wallet_ecdsa_execution (
    owner_json TEXT PRIMARY KEY,
    authority_json TEXT NOT NULL)";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "origin", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum ExecutionAuthority {
    Registration {
        material_key: String,
    },
    Relocation {
        request: SigningWorkerRelocationRequestV1,
    },
    EmptySource {
        request: SigningWorkerRelocationRequestV1,
    },
}

impl ExecutionAuthority {
    pub(super) fn generation(&self) -> RouterAbProtocolResult<u64> {
        match self {
            Self::Registration { material_key } => {
                crate::require_non_empty("execution registration material key", material_key)?;
                Ok(1)
            }
            Self::Relocation { request } => {
                request.validate()?;
                Ok(request.source_generation + 1)
            }
            Self::EmptySource { request } => {
                request.validate()?;
                Ok(request.source_generation)
            }
        }
    }
}

#[derive(Deserialize)]
struct AuthorityRow {
    authority_json: String,
}

impl<Sql: SigningWorkerWalletSqlV1> SigningWorkerWalletEcdsaStoreV1<'_, Sql> {
    pub(super) fn execution_authority(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
    ) -> RouterAbProtocolResult<Option<ExecutionAuthority>> {
        let rows = self.sql.query::<AuthorityRow>(
            "SELECT authority_json FROM wallet_ecdsa_execution WHERE owner_json = ?",
            vec![text(owner_json(scope, "ECDSA execution")?)],
        )?;
        match rows.as_slice() {
            [] => Ok(None),
            [row] => {
                let authority: ExecutionAuthority = serde_json::from_str(&row.authority_json)
                    .map_err(|error| wallet_error(error.to_string()))?;
                authority.generation()?;
                Ok(Some(authority))
            }
            _ => Err(wallet_error("ECDSA execution authority is duplicated")),
        }
    }

    pub(super) fn install_execution_authority(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        authority: ExecutionAuthority,
    ) -> RouterAbProtocolResult<()> {
        authority.generation()?;
        let encoded =
            serde_json::to_string(&authority).map_err(|error| wallet_error(error.to_string()))?;
        self.sql.query::<serde::de::IgnoredAny>(
            "INSERT INTO wallet_ecdsa_execution (owner_json, authority_json) VALUES (?, ?)
             ON CONFLICT(owner_json) DO NOTHING",
            vec![text(owner_json(scope, "ECDSA execution")?), text(encoded)],
        )?;
        if self.execution_authority(scope)?.as_ref() != Some(&authority) {
            return Err(wallet_error("ECDSA execution authority changed"));
        }
        Ok(())
    }

    pub(crate) fn require_execution_generation(
        &self,
        scope: &CloudflareSigningWorkerWalletScopeV1,
        ownership_generation: u64,
    ) -> RouterAbProtocolResult<()> {
        crate::router_wallet::validate_wallet_ownership_generation(ownership_generation)?;
        let authority = self
            .execution_authority(scope)?
            .ok_or_else(|| wallet_error("ECDSA execution authority is missing"))?;
        if matches!(authority, ExecutionAuthority::EmptySource { .. }) {
            return Err(wallet_error("An empty relocation source cannot execute"));
        }
        if authority.generation()? != ownership_generation {
            return Err(wallet_error("ECDSA execution ownership generation differs"));
        }
        Ok(())
    }
}
