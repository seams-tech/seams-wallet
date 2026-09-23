use crate::{
    require_no_ascii_whitespace, require_non_empty, ActiveWalletLaneAuthorityV1,
    SIGNING_WORKER_PRIVATE_D1_BINDING_V1,
};
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::Deserialize;
use wasm_bindgen::JsValue;
use worker::{D1Database, D1SessionConstraint, Env};

const DERIVER_ROLE_PRIVATE_D1_BINDING_V1: &str = "DERIVER_ROLE_PRIVATE_DB";

#[derive(Debug, Deserialize)]
struct WalletLaneAuthorityD1RowV1 {
    wallet_id: String,
    lane_id: String,
    lane_epoch: i64,
    directory_revision: i64,
    lifecycle: String,
    migration_id: Option<String>,
}

/// Loads the active authority from a Deriver's lane-local primary D1.
pub async fn load_cloudflare_deriver_active_wallet_lane_authority_v1(
    env: &Env,
    wallet_id: &str,
) -> RouterAbProtocolResult<ActiveWalletLaneAuthorityV1> {
    let database = wallet_lane_authority_database_from_env_v1(
        env,
        DERIVER_ROLE_PRIVATE_D1_BINDING_V1,
        "Deriver lane authority D1 binding is missing",
    )?;
    load_cloudflare_active_wallet_lane_authority_v1(&database, wallet_id).await
}

/// Loads the active authority from a SigningWorker's lane-local primary D1.
pub async fn load_cloudflare_signing_worker_active_wallet_lane_authority_v1(
    env: &Env,
    wallet_id: &str,
) -> RouterAbProtocolResult<ActiveWalletLaneAuthorityV1> {
    let database = wallet_lane_authority_database_from_env_v1(
        env,
        SIGNING_WORKER_PRIVATE_D1_BINDING_V1,
        "SigningWorker lane authority D1 binding is missing",
    )?;
    load_cloudflare_active_wallet_lane_authority_v1(&database, wallet_id).await
}

/// Reads one authority through a primary-consistent D1 session and requires it to be active.
pub async fn load_cloudflare_active_wallet_lane_authority_v1(
    database: &D1Database,
    wallet_id: &str,
) -> RouterAbProtocolResult<ActiveWalletLaneAuthorityV1> {
    require_non_empty("wallet lane authority wallet id", wallet_id)?;
    require_no_ascii_whitespace("wallet lane authority wallet id", wallet_id)?;
    let session = database
        .with_session_constraint(D1SessionConstraint::FirstPrimary)
        .map_err(|error| map_wallet_lane_authority_d1_error("primary session failed", error))?;
    let row = session
        .prepare(
            "SELECT wallet_id, lane_id, lane_epoch, directory_revision, lifecycle, migration_id
             FROM wallet_lane_authorities
             WHERE wallet_id = ?1",
        )
        .bind(&[JsValue::from_str(wallet_id)])
        .map_err(|error| map_wallet_lane_authority_d1_error("query bind failed", error))?
        .first::<WalletLaneAuthorityD1RowV1>(None)
        .await
        .map_err(|error| map_wallet_lane_authority_d1_error("query failed", error))?
        .ok_or_else(|| {
            RouterAbProtocolError::new(
                RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
                "wallet has no authority in this regional lane",
            )
        })?;
    active_wallet_lane_authority_from_d1_row_v1(row, wallet_id)
}

fn active_wallet_lane_authority_from_d1_row_v1(
    row: WalletLaneAuthorityD1RowV1,
    expected_wallet_id: &str,
) -> RouterAbProtocolResult<ActiveWalletLaneAuthorityV1> {
    if row.wallet_id != expected_wallet_id {
        return Err(wallet_lane_authority_d1_error(
            "wallet authority query returned a different wallet",
        ));
    }
    if row.lifecycle != "active" || row.migration_id.is_some() {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLifecycleState,
            "wallet lane authority is not active",
        ));
    }
    let lane_epoch = u64::try_from(row.lane_epoch)
        .map_err(|_| wallet_lane_authority_d1_error("lane epoch is invalid"))?;
    let directory_revision = u64::try_from(row.directory_revision)
        .map_err(|_| wallet_lane_authority_d1_error("directory revision is invalid"))?;
    ActiveWalletLaneAuthorityV1::new(row.wallet_id, row.lane_id, lane_epoch, directory_revision)
        .map_err(|error| {
            wallet_lane_authority_d1_error(format!("stored authority is invalid: {error}"))
        })
}

fn wallet_lane_authority_database_from_env_v1(
    env: &Env,
    binding: &str,
    missing_message: &'static str,
) -> RouterAbProtocolResult<D1Database> {
    env.d1(binding).map_err(|error| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::MissingLocalBinding,
            format!("{missing_message}: {error}"),
        )
    })
}

fn map_wallet_lane_authority_d1_error(
    operation: &'static str,
    error: worker::Error,
) -> RouterAbProtocolError {
    wallet_lane_authority_d1_error(format!("wallet lane authority D1 {operation}: {error}"))
}

fn wallet_lane_authority_d1_error(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        message,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(lifecycle: &str, migration_id: Option<&str>) -> WalletLaneAuthorityD1RowV1 {
        WalletLaneAuthorityD1RowV1 {
            wallet_id: "wallet:lane-authority-fixture".into(),
            lane_id: "managed-apac-v1".into(),
            lane_epoch: 2,
            directory_revision: 4,
            lifecycle: lifecycle.into(),
            migration_id: migration_id.map(str::to_owned),
        }
    }

    #[test]
    fn parses_exact_active_authority() {
        let authority = active_wallet_lane_authority_from_d1_row_v1(
            row("active", None),
            "wallet:lane-authority-fixture",
        )
        .expect("active authority");

        assert_eq!(authority.wallet_id(), "wallet:lane-authority-fixture");
        assert_eq!(authority.lane_id(), "managed-apac-v1");
        assert_eq!(authority.lane_epoch(), 2);
        assert_eq!(authority.directory_revision(), 4);
    }

    #[test]
    fn rejects_migrating_and_malformed_authority() {
        let migrating = active_wallet_lane_authority_from_d1_row_v1(
            row("source_frozen", Some("migration-1")),
            "wallet:lane-authority-fixture",
        )
        .expect_err("migrating authority");
        assert_eq!(
            migrating.code(),
            RouterAbProtocolErrorCode::InvalidLifecycleState
        );

        let malformed = active_wallet_lane_authority_from_d1_row_v1(
            WalletLaneAuthorityD1RowV1 {
                lane_epoch: 0,
                ..row("active", None)
            },
            "wallet:lane-authority-fixture",
        )
        .expect_err("malformed authority");
        assert_eq!(
            malformed.code(),
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig
        );
    }
}
