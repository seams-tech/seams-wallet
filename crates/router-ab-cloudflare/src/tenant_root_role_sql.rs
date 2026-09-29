//! The SQL surface a Deriver's tenant-root role store uses, independent of
//! its host. Cloudflare implements it with the role-private D1 session; a VM
//! Deriver implements it with a role-private SQLite file. The store's
//! statements, schema and invariants are shared; only execution differs.

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

#[cfg(feature = "workers-rs")]
impl From<worker::Error> for RoleStoreError {
    fn from(error: worker::Error) -> Self {
        Self(error.to_string())
    }
}

#[cfg(feature = "workers-rs")]
impl From<RoleStoreError> for worker::Error {
    fn from(error: RoleStoreError) -> Self {
        worker::Error::RustError(error.0)
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
        self.session.run_statement(self, RoleSqlReadV1::Changes).await
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

/// A role-private SQL session. `batch` runs its statements as one atomic unit.
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

    async fn batch(
        &self,
        statements: Vec<RoleSqlStatement<'_, Self>>,
    ) -> RoleStoreResult<Vec<Self::Outcome>>;
}

/// The Cloudflare host: the role-private D1 session. Rows keep D1's own
/// deserialization so stored values decode exactly as before.
#[cfg(feature = "workers-rs")]
pub struct D1RoleSqlSessionV1 {
    session: worker::D1DatabaseSession,
}

#[cfg(feature = "workers-rs")]
impl D1RoleSqlSessionV1 {
    pub fn new(session: worker::D1DatabaseSession) -> Self {
        Self { session }
    }

    fn d1_statement(
        &self,
        statement: &RoleSqlStatement<'_, Self>,
    ) -> RoleStoreResult<worker::D1PreparedStatement> {
        let values: Vec<worker::D1Type<'_>> = statement
            .params()
            .iter()
            .map(|value| match value {
                RoleSqlOwnedValueV1::Text(text) => worker::D1Type::Text(text.as_str()),
                RoleSqlOwnedValueV1::Null => worker::D1Type::Null,
            })
            .collect();
        Ok(self
            .session
            .prepare(statement.sql())
            .bind_refs(values.iter())?)
    }
}

#[cfg(feature = "workers-rs")]
impl RoleSqlOutcomeV1 for worker::D1Result {
    fn success(&self) -> bool {
        worker::D1Result::success(self)
    }

    fn error(&self) -> Option<String> {
        worker::D1Result::error(self)
    }

    fn changes(&self) -> RoleStoreResult<usize> {
        Ok(self
            .meta()?
            .and_then(|metadata| metadata.changes)
            .unwrap_or_default())
    }

    fn results<T: DeserializeOwned>(&self) -> RoleStoreResult<Vec<T>> {
        Ok(worker::D1Result::results::<T>(self)?)
    }
}

#[cfg(feature = "workers-rs")]
impl RoleSqlSessionV1 for D1RoleSqlSessionV1 {
    type Outcome = worker::D1Result;

    async fn run_statement(
        &self,
        statement: &RoleSqlStatement<'_, Self>,
        read: RoleSqlReadV1,
    ) -> RoleStoreResult<worker::D1Result> {
        let prepared = self.d1_statement(statement)?;
        Ok(match read {
            RoleSqlReadV1::Changes => prepared.run().await?,
            RoleSqlReadV1::Rows => prepared.all().await?,
        })
    }

    async fn first_row<T: DeserializeOwned>(
        &self,
        statement: &RoleSqlStatement<'_, Self>,
    ) -> RoleStoreResult<Option<T>> {
        Ok(self.d1_statement(statement)?.first::<T>(None).await?)
    }

    async fn batch(
        &self,
        statements: Vec<RoleSqlStatement<'_, Self>>,
    ) -> RoleStoreResult<Vec<worker::D1Result>> {
        let prepared = statements
            .iter()
            .map(|statement| self.d1_statement(statement))
            .collect::<RoleStoreResult<Vec<_>>>()?;
        Ok(self.session.batch(prepared).await?)
    }
}
