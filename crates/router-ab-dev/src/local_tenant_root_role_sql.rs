//! A VM Deriver's role-private SQLite as the role-store SQL session. The
//! tenant-root role store runs the same statements, schema and invariants it
//! runs on role-private D1; this file only executes them.

use std::cell::RefCell;
use std::path::Path;

use router_ab_cloudflare::{
    RoleSqlOutcomeV1, RoleSqlOwnedValueV1, RoleSqlReadV1, RoleSqlSessionV1, RoleSqlStatement,
    RoleStoreError, RoleStoreResult,
};
use rusqlite::{types::ValueRef, Connection};
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

const MIGRATION_LEDGER_TABLE: &str = "local_sqlite_migrations";

/// One executed statement: success, changed rows and named-column rows.
#[derive(Debug, Clone)]
pub struct LocalRoleSqlOutcomeV1 {
    changes: usize,
    rows: Vec<Map<String, Value>>,
}

impl RoleSqlOutcomeV1 for LocalRoleSqlOutcomeV1 {
    fn success(&self) -> bool {
        true
    }

    fn error(&self) -> Option<String> {
        None
    }

    fn changes(&self) -> RoleStoreResult<usize> {
        Ok(self.changes)
    }

    fn results<T: DeserializeOwned>(&self) -> RoleStoreResult<Vec<T>> {
        self.rows
            .iter()
            .map(|row| Ok(serde_json::from_value(Value::Object(row.clone()))?))
            .collect()
    }
}

/// A role-private SQLite connection. A failing statement surfaces as an
/// error, and a batch commits all of its statements or none of them, as a
/// D1 batch does.
pub struct LocalRoleSqlSessionV1 {
    connection: RefCell<Connection>,
}

impl LocalRoleSqlSessionV1 {
    pub fn open(path: &Path) -> RoleStoreResult<Self> {
        let connection = Connection::open(path).map_err(sql_error)?;
        connection
            .execute_batch("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .map_err(sql_error)?;
        Ok(Self {
            connection: RefCell::new(connection),
        })
    }

    fn execute(
        connection: &Connection,
        sql: &str,
        params: &[RoleSqlOwnedValueV1],
    ) -> RoleStoreResult<LocalRoleSqlOutcomeV1> {
        let mut statement = connection.prepare(sql).map_err(sql_error)?;
        let values: Vec<rusqlite::types::Value> = params
            .iter()
            .map(|value| match value {
                RoleSqlOwnedValueV1::Text(text) => rusqlite::types::Value::Text(text.clone()),
                RoleSqlOwnedValueV1::Null => rusqlite::types::Value::Null,
            })
            .collect();
        let columns: Vec<String> = statement
            .column_names()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect();
        let mut rows = Vec::new();
        {
            let mut query = statement
                .query(rusqlite::params_from_iter(values.iter()))
                .map_err(sql_error)?;
            while let Some(row) = query.next().map_err(sql_error)? {
                let mut object = Map::new();
                for (index, name) in columns.iter().enumerate() {
                    object.insert(name.clone(), json_value(row.get_ref(index).map_err(sql_error)?)?);
                }
                rows.push(object);
            }
        }
        Ok(LocalRoleSqlOutcomeV1 {
            changes: usize::try_from(connection.changes()).unwrap_or_default(),
            rows,
        })
    }
}

impl RoleSqlSessionV1 for LocalRoleSqlSessionV1 {
    type Outcome = LocalRoleSqlOutcomeV1;

    async fn run_statement(
        &self,
        statement: &RoleSqlStatement<'_, Self>,
        _read: RoleSqlReadV1,
    ) -> RoleStoreResult<LocalRoleSqlOutcomeV1> {
        let connection = self.connection.borrow();
        Self::execute(&connection, statement.sql(), statement.params())
    }

    async fn first_row<T: DeserializeOwned>(
        &self,
        statement: &RoleSqlStatement<'_, Self>,
    ) -> RoleStoreResult<Option<T>> {
        let connection = self.connection.borrow();
        let outcome = Self::execute(&connection, statement.sql(), statement.params())?;
        match outcome.rows.into_iter().next() {
            Some(row) => Ok(Some(serde_json::from_value(Value::Object(row))?)),
            None => Ok(None),
        }
    }

    async fn batch(
        &self,
        statements: Vec<RoleSqlStatement<'_, Self>>,
    ) -> RoleStoreResult<Vec<LocalRoleSqlOutcomeV1>> {
        let mut connection = self.connection.borrow_mut();
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        let mut outcomes = Vec::with_capacity(statements.len());
        for statement in &statements {
            // A failing statement drops the transaction, rolling back the batch.
            outcomes.push(Self::execute(&transaction, statement.sql(), statement.params())?);
        }
        transaction.commit().map_err(sql_error)?;
        Ok(outcomes)
    }
}

/// One shipped schema migration: its file name and SQL.
pub type LocalSqliteMigrationV1 = (&'static str, &'static str);

/// Deriver A's role-private schema: the same migrations its Cloudflare D1
/// database runs.
pub const LOCAL_DERIVER_A_ROLE_PRIVATE_MIGRATIONS_V1: &[LocalSqliteMigrationV1] = &[
    ("0001_role_private_storage.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0001_role_private_storage.sql")),
    ("0002_tenant_root_role_shares.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0002_tenant_root_role_shares.sql")),
    ("0003_tenant_root_command_replays.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0003_tenant_root_command_replays.sql")),
    ("0004_tenant_root_creation_admission.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0004_tenant_root_creation_admission.sql")),
    ("0005_tenant_root_refresh_state.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0005_tenant_root_refresh_state.sql")),
    ("0006_tenant_root_restore_import_keys.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0006_tenant_root_restore_import_keys.sql")),
    ("0007_tenant_root_restore_refresh_attempts.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0007_tenant_root_restore_refresh_attempts.sql")),
    ("0008_tenant_root_restore_promotion.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0008_tenant_root_restore_promotion.sql")),
    ("0009_tenant_root_restore_preactivation_cleanup.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0009_tenant_root_restore_preactivation_cleanup.sql")),
    ("0010_tenant_root_recovery_attempts.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0010_tenant_root_recovery_attempts.sql")),
    ("0011_tenant_root_source_retirement.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0011_tenant_root_source_retirement.sql")),
    ("0012_tenant_root_creation_tombstones.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-a/0012_tenant_root_creation_tombstones.sql")),
];
/// Deriver B's role-private schema: the same migrations its Cloudflare D1
/// database runs.
pub const LOCAL_DERIVER_B_ROLE_PRIVATE_MIGRATIONS_V1: &[LocalSqliteMigrationV1] = &[
    ("0001_role_private_storage.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0001_role_private_storage.sql")),
    ("0002_tenant_root_role_shares.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0002_tenant_root_role_shares.sql")),
    ("0003_tenant_root_command_replays.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0003_tenant_root_command_replays.sql")),
    ("0004_tenant_root_creation_admission.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0004_tenant_root_creation_admission.sql")),
    ("0005_tenant_root_refresh_state.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0005_tenant_root_refresh_state.sql")),
    ("0006_tenant_root_restore_import_keys.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0006_tenant_root_restore_import_keys.sql")),
    ("0007_tenant_root_restore_refresh_attempts.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0007_tenant_root_restore_refresh_attempts.sql")),
    ("0008_tenant_root_restore_promotion.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0008_tenant_root_restore_promotion.sql")),
    ("0009_tenant_root_restore_preactivation_cleanup.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0009_tenant_root_restore_preactivation_cleanup.sql")),
    ("0010_tenant_root_recovery_attempts.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0010_tenant_root_recovery_attempts.sql")),
    ("0011_tenant_root_source_retirement.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0011_tenant_root_source_retirement.sql")),
    ("0012_tenant_root_creation_tombstones.sql", include_str!("../../router-ab-cloudflare/migrations/deriver-b/0012_tenant_root_creation_tombstones.sql")),
];
/// The VM Router's tenant-root creation-state schema.
pub const LOCAL_ROUTER_CREATION_STATE_MIGRATIONS_V1: &[LocalSqliteMigrationV1] = &[
    ("0001_creation_state.sql", include_str!("../migrations/local-router-creation-state/0001_creation_state.sql")),
];
/// A VM Deriver's managed-backup schema.
pub const LOCAL_MANAGED_BACKUP_MIGRATIONS_V1: &[LocalSqliteMigrationV1] = &[
    ("0001_managed_backups.sql", include_str!("../migrations/local-managed-backups/0001_managed_backups.sql")),
    ("0002_object_generations.sql", include_str!("../migrations/local-managed-backups/0002_object_generations.sql")),
];

/// Applied, pending and unknown migrations for one SQLite file.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct LocalSqliteMigrationStatusV1 {
    pub applied: Vec<String>,
    pub pending: Vec<String>,
    pub unknown: Vec<String>,
}

impl LocalSqliteMigrationStatusV1 {
    pub fn is_current(&self) -> bool {
        self.pending.is_empty() && self.unknown.is_empty()
    }
}

/// Reads which of a shipped chain's migrations a file has applied. A missing
/// file has applied none.
pub fn local_sqlite_migration_status_v1(
    path: &Path,
    chain: &[LocalSqliteMigrationV1],
) -> RoleStoreResult<LocalSqliteMigrationStatusV1> {
    let applied = if path.exists() {
        let connection = Connection::open(path).map_err(sql_error)?;
        read_applied_migrations(&connection)?
    } else {
        Vec::new()
    };
    let shipped: Vec<&str> = chain.iter().map(|(name, _)| *name).collect();
    Ok(LocalSqliteMigrationStatusV1 {
        unknown: applied
            .iter()
            .filter(|name| !shipped.contains(&name.as_str()))
            .cloned()
            .collect(),
        pending: shipped
            .iter()
            .filter(|name| !applied.iter().any(|applied| applied == *name))
            .map(|name| (*name).to_owned())
            .collect(),
        applied,
    })
}

/// Applies a shipped chain in order, each migration with its ledger row in
/// one transaction. Refuses a file carrying migrations the chain does not
/// ship, or applied out of order.
pub fn apply_local_sqlite_migrations_v1(
    path: &Path,
    chain: &[LocalSqliteMigrationV1],
) -> RoleStoreResult<Vec<String>> {
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|error| RoleStoreError::message(error.to_string()))?;
    }
    let mut connection = Connection::open(path).map_err(sql_error)?;
    connection
        .execute_batch("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;")
        .map_err(sql_error)?;
    let applied = read_applied_migrations(&connection)?;
    let shipped: Vec<&str> = chain.iter().map(|(name, _)| *name).collect();
    if let Some(unknown) = applied.iter().find(|name| !shipped.contains(&name.as_str())) {
        return Err(RoleStoreError::message(format!(
            "SQLite file has migration {unknown} this build does not ship"
        )));
    }
    if applied.iter().zip(shipped.iter()).any(|(left, right)| left != right) {
        return Err(RoleStoreError::message(
            "applied migrations are not a prefix of the shipped chain",
        ));
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default();
    let mut newly_applied = Vec::new();
    for (name, sql) in chain.iter().skip(applied.len()) {
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        transaction.execute_batch(sql).map_err(sql_error)?;
        transaction
            .execute(
                &format!("INSERT INTO {MIGRATION_LEDGER_TABLE} (name, applied_at_ms) VALUES (?1, ?2)"),
                rusqlite::params![name, now_ms],
            )
            .map_err(sql_error)?;
        transaction.commit().map_err(sql_error)?;
        newly_applied.push((*name).to_owned());
    }
    Ok(newly_applied)
}

fn read_applied_migrations(connection: &Connection) -> RoleStoreResult<Vec<String>> {
    connection
        .execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {MIGRATION_LEDGER_TABLE} (name TEXT PRIMARY KEY, applied_at_ms INTEGER NOT NULL);"
        ))
        .map_err(sql_error)?;
    let mut statement = connection
        .prepare(&format!("SELECT name FROM {MIGRATION_LEDGER_TABLE} ORDER BY name"))
        .map_err(sql_error)?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    Ok(names)
}

fn json_value(value: ValueRef<'_>) -> RoleStoreResult<Value> {
    Ok(match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(integer) => Value::from(integer),
        ValueRef::Real(real) => serde_json::Number::from_f64(real)
            .map(Value::Number)
            .ok_or_else(|| RoleStoreError::message("role-private SQLite returned a non-finite real"))?,
        ValueRef::Text(text) => Value::String(
            std::str::from_utf8(text)
                .map_err(|_| RoleStoreError::message("role-private SQLite returned non-UTF-8 text"))?
                .to_owned(),
        ),
        ValueRef::Blob(_) => {
            return Err(RoleStoreError::message(
                "role-private SQLite returned a blob the role store does not store",
            ))
        }
    })
}

fn sql_error(error: rusqlite::Error) -> RoleStoreError {
    RoleStoreError::message(format!("role-private SQLite failed: {error}"))
}
