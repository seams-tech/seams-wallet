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

const MIGRATION_LEDGER_TABLE: &str = "local_role_private_migrations";

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

/// Applies the shipped role-private migrations in order, each with its
/// ledger row in one transaction. Refuses a database carrying migrations
/// this build does not know.
pub fn apply_local_role_private_migrations_v1(
    path: &Path,
    migrations_dir: &Path,
) -> RoleStoreResult<Vec<String>> {
    let mut connection = Connection::open(path).map_err(sql_error)?;
    connection
        .execute_batch(&format!(
            "PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS {MIGRATION_LEDGER_TABLE} (name TEXT PRIMARY KEY, applied_at_ms INTEGER NOT NULL);"
        ))
        .map_err(sql_error)?;
    let mut shipped: Vec<String> = std::fs::read_dir(migrations_dir)
        .map_err(|error| RoleStoreError::message(error.to_string()))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".sql"))
        .collect();
    shipped.sort();
    let applied: Vec<String> = {
        let mut statement = connection
            .prepare(&format!("SELECT name FROM {MIGRATION_LEDGER_TABLE} ORDER BY name"))
            .map_err(sql_error)?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        names
    };
    if let Some(unknown) = applied.iter().find(|name| !shipped.contains(name)) {
        return Err(RoleStoreError::message(format!(
            "role-private database has migration {unknown} this build does not ship"
        )));
    }
    if applied.iter().zip(shipped.iter()).any(|(left, right)| left != right) {
        return Err(RoleStoreError::message(
            "applied role-private migrations are not a prefix of the shipped chain",
        ));
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default();
    let mut newly_applied = Vec::new();
    for name in shipped.iter().skip(applied.len()) {
        let sql = std::fs::read_to_string(migrations_dir.join(name))
            .map_err(|error| RoleStoreError::message(error.to_string()))?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        transaction.execute_batch(&sql).map_err(sql_error)?;
        transaction
            .execute(
                &format!("INSERT INTO {MIGRATION_LEDGER_TABLE} (name, applied_at_ms) VALUES (?1, ?2)"),
                rusqlite::params![name, now_ms],
            )
            .map_err(sql_error)?;
        transaction.commit().map_err(sql_error)?;
        newly_applied.push(name.clone());
    }
    Ok(newly_applied)
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
