//! The execution contract for a Deriver's tenant-root role store.
//! Shared statements use PostgreSQL parameter positions. Each driver implements
//! atomic transactions and row-count expectations at the database boundary.

#[cfg(feature = "workers-rs")]
mod d1;
#[cfg(feature = "workers-rs")]
pub use d1::D1RoleSqlSessionV1;

#[cfg(all(feature = "postgres", not(target_arch = "wasm32")))]
mod postgres;
#[cfg(all(feature = "postgres", not(target_arch = "wasm32")))]
pub use postgres::{
    apply_postgres_role_store_schema_v1, PostgresRoleSqlOutcomeV1, PostgresRoleSqlSessionV1,
};

use core::fmt;

use serde::de::DeserializeOwned;

/// Error returned by role-store operations on every host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleStoreError(String);

impl RoleStoreError {
    pub fn message(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for RoleStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for RoleStoreError {}

impl From<serde_json::Error> for RoleStoreError {
    fn from(error: serde_json::Error) -> Self {
        Self(error.to_string())
    }
}

pub type RoleStoreResult<T> = Result<T, RoleStoreError>;

/// A bound parameter. The role store binds only text and null.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleSqlValue<'a> {
    Text(&'a str),
    Null,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoleSqlOwnedValueV1 {
    Text(String),
    Null,
}

/// One prepared statement with its bound parameters.
pub struct RoleSqlStatement<'s, S: RoleSqlSessionV1 + ?Sized> {
    session: &'s S,
    sql: String,
    params: Vec<RoleSqlOwnedValueV1>,
}

impl<'s, S: RoleSqlSessionV1 + ?Sized> RoleSqlStatement<'s, S> {
    pub fn sql(&self) -> &str {
        &self.sql
    }

    pub fn params(&self) -> &[RoleSqlOwnedValueV1] {
        &self.params
    }

    /// Requires this mutation to change exactly `count` rows before commit.
    /// The returned statement can run only through `transaction`.
    pub fn expect_changes(self, count: usize) -> RoleSqlTransactionStatement<'s, S> {
        RoleSqlTransactionStatement::ExpectChanges {
            statement: self,
            count,
        }
    }

    pub fn bind_refs<'v>(
        mut self,
        values: impl IntoIterator<Item = &'v RoleSqlValue<'v>>,
    ) -> RoleStoreResult<Self> {
        self.params = values
            .into_iter()
            .map(|value| match value {
                RoleSqlValue::Text(text) => RoleSqlOwnedValueV1::Text((*text).to_owned()),
                RoleSqlValue::Null => RoleSqlOwnedValueV1::Null,
            })
            .collect();
        Ok(self)
    }

    pub async fn run(&self) -> RoleStoreResult<S::Outcome> {
        self.session
            .run_statement(self, RoleSqlReadV1::Changes)
            .await
    }

    pub async fn all(&self) -> RoleStoreResult<S::Outcome> {
        self.session.run_statement(self, RoleSqlReadV1::Rows).await
    }

    pub async fn first<T: DeserializeOwned>(
        &self,
        column: Option<&str>,
    ) -> RoleStoreResult<Option<T>> {
        if column.is_some() {
            return Err(RoleStoreError::message(
                "role store reads whole rows, not single columns",
            ));
        }
        self.session.first_row(self).await
    }
}

/// A transaction statement, with an optional affected-row requirement.
pub enum RoleSqlTransactionStatement<'s, S: RoleSqlSessionV1 + ?Sized> {
    Execute(RoleSqlStatement<'s, S>),
    ExpectChanges {
        statement: RoleSqlStatement<'s, S>,
        count: usize,
    },
}

impl<'s, S: RoleSqlSessionV1 + ?Sized> From<RoleSqlStatement<'s, S>>
    for RoleSqlTransactionStatement<'s, S>
{
    fn from(statement: RoleSqlStatement<'s, S>) -> Self {
        Self::Execute(statement)
    }
}

/// Whether a statement is executed for its row changes or for its rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleSqlReadV1 {
    Changes,
    Rows,
}

/// The outcome of one executed statement.
pub trait RoleSqlOutcomeV1 {
    fn success(&self) -> bool;
    /// The host's failure text for an unsuccessful statement, if it has one.
    fn error(&self) -> Option<String>;
    fn changes(&self) -> RoleStoreResult<usize>;
    fn results<T: DeserializeOwned>(&self) -> RoleStoreResult<Vec<T>>;
}

/// A role-private SQL session. A session must never span Deriver A and B.
#[allow(async_fn_in_trait)]
pub trait RoleSqlSessionV1 {
    type Outcome: RoleSqlOutcomeV1;

    fn prepare(&self, sql: &str) -> RoleSqlStatement<'_, Self> {
        RoleSqlStatement {
            session: self,
            sql: sql.to_owned(),
            params: Vec::new(),
        }
    }

    async fn run_statement(
        &self,
        statement: &RoleSqlStatement<'_, Self>,
        read: RoleSqlReadV1,
    ) -> RoleStoreResult<Self::Outcome>;

    async fn first_row<T: DeserializeOwned>(
        &self,
        statement: &RoleSqlStatement<'_, Self>,
    ) -> RoleStoreResult<Option<T>>;

    /// Executes statements in order as one durable, atomic transaction.
    /// Reads must share one coherent snapshot and see earlier writes here.
    /// Concurrent transactions must preserve the same effect as serial execution.
    /// On any statement error or row-count mismatch, roll back every write
    /// before commit. Checking row counts after commit cannot satisfy this contract.
    /// Returns one outcome per supplied statement, in order, after commit.
    /// Driver-internal guard statements must not appear in the outcomes.
    async fn transaction(
        &self,
        statements: Vec<RoleSqlTransactionStatement<'_, Self>>,
    ) -> RoleStoreResult<Vec<Self::Outcome>>;
}

/// Locates numbered parameters while preserving quoted SQL literals and names.
/// Shared role-store statements use `$1`, `$2`, and repeated positions.
fn parameter_positions(sql: &str) -> RoleStoreResult<Vec<(core::ops::Range<usize>, usize)>> {
    let bytes = sql.as_bytes();
    let mut positions = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            quote @ (b'\'' | b'"') => {
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == quote {
                        index += 1;
                        if bytes.get(index) != Some(&quote) {
                            break;
                        }
                    }
                    index += 1;
                }
            }
            b'$' => {
                let start = index;
                index += 1;
                while bytes.get(index).is_some_and(u8::is_ascii_digit) {
                    index += 1;
                }
                let position = sql[start + 1..index].parse::<usize>().map_err(|_| {
                    RoleStoreError::message("role-store SQL requires numbered parameters")
                })?;
                if position == 0 {
                    return Err(RoleStoreError::message(
                        "role-store parameter positions start at one",
                    ));
                }
                positions.push((start..index, position));
            }
            _ => index += 1,
        }
    }
    Ok(positions)
}
