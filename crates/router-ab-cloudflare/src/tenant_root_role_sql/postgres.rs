use super::{
    parameter_positions, RoleSqlOutcomeV1, RoleSqlOwnedValueV1, RoleSqlReadV1, RoleSqlSessionV1,
    RoleSqlStatement, RoleSqlTransactionStatement, RoleStoreError, RoleStoreResult,
};
use crate::CloudflareTenantRootDeriverRoleV1;
use futures::{pin_mut, TryStreamExt};
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use tokio::sync::Mutex;
use tokio_postgres::{
    error::SqlState,
    types::{ToSql, Type},
    Client, IsolationLevel, Row, Transaction,
};

const SERIALIZATION_RETRIES: usize = 3;
const SCHEMA: &str = include_str!("../../migrations/postgres/0001_role_store.sql");

/// Applies the initial schema to an empty, role-private PostgreSQL database.
/// Call this with migration credentials. Runtime credentials need only DML access.
pub async fn apply_postgres_role_store_schema_v1(
    client: &mut Client,
    role: CloudflareTenantRootDeriverRoleV1,
) -> RoleStoreResult<()> {
    let transaction = client.transaction().await.map_err(database_error)?;
    transaction
        .batch_execute("SET LOCAL search_path = public, pg_catalog, pg_temp; SET LOCAL synchronous_commit = on")
        .await
        .map_err(database_error)?;
    let role_function = format!(
        "CREATE FUNCTION public.tenant_root_store_role() RETURNS TEXT \
         LANGUAGE SQL IMMUTABLE AS $$ SELECT '{}'::TEXT $$;",
        role.as_str(),
    );
    transaction
        .batch_execute(&role_function)
        .await
        .map_err(database_error)?;
    transaction
        .batch_execute(SCHEMA)
        .await
        .map_err(database_error)?;
    transaction.commit().await.map_err(database_error)
}

/// A native PostgreSQL session for exactly one Deriver's database.
/// The host owns connection setup, TLS, credentials, and connection-task lifetime.
pub struct PostgresRoleSqlSessionV1 {
    client: Mutex<Client>,
}

impl PostgresRoleSqlSessionV1 {
    pub async fn new(
        client: Client,
        role: CloudflareTenantRootDeriverRoleV1,
    ) -> RoleStoreResult<Self> {
        let row = client
            .query_one("SELECT public.tenant_root_store_role()", &[])
            .await
            .map_err(database_error)?;
        let stored_role: String = row.try_get(0).map_err(database_error)?;
        if stored_role != role.as_str() {
            return Err(RoleStoreError::message(
                "PostgreSQL role-store identity mismatch",
            ));
        }
        Ok(Self {
            client: Mutex::new(client),
        })
    }

    async fn execute(
        &self,
        statements: &[(&RoleSqlStatement<'_, Self>, Option<usize>)],
    ) -> RoleStoreResult<Vec<PostgresRoleSqlOutcomeV1>> {
        let mut client = self.client.lock().await;
        for attempt in 0..=SERIALIZATION_RETRIES {
            match execute_transaction(&mut client, statements).await {
                Ok(outcomes) => return Ok(outcomes),
                Err(PostgresTransactionError::Database(error))
                    if retryable(&error) && attempt < SERIALIZATION_RETRIES =>
                {
                    tokio::time::sleep(std::time::Duration::from_millis(5 << attempt)).await;
                }
                Err(PostgresTransactionError::Database(error)) => {
                    return Err(database_error(error))
                }
                Err(PostgresTransactionError::Store(error)) => return Err(error),
            }
        }
        unreachable!("every transaction attempt returns or retries")
    }
}

/// Fully decoded outcomes return only after the transaction commits.
pub struct PostgresRoleSqlOutcomeV1 {
    changes: usize,
    rows: Vec<Value>,
}

impl RoleSqlOutcomeV1 for PostgresRoleSqlOutcomeV1 {
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
            .cloned()
            .map(serde_json::from_value)
            .collect::<Result<_, _>>()
            .map_err(Into::into)
    }
}

impl RoleSqlSessionV1 for PostgresRoleSqlSessionV1 {
    type Outcome = PostgresRoleSqlOutcomeV1;

    async fn run_statement(
        &self,
        statement: &RoleSqlStatement<'_, Self>,
        _read: RoleSqlReadV1,
    ) -> RoleStoreResult<Self::Outcome> {
        self.execute(&[(statement, None)])
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| RoleStoreError::message("PostgreSQL transaction omitted its outcome"))
    }

    async fn first_row<T: DeserializeOwned>(
        &self,
        statement: &RoleSqlStatement<'_, Self>,
    ) -> RoleStoreResult<Option<T>> {
        let outcome = self.run_statement(statement, RoleSqlReadV1::Rows).await?;
        outcome
            .rows
            .into_iter()
            .next()
            .map(serde_json::from_value)
            .transpose()
            .map_err(Into::into)
    }

    async fn transaction(
        &self,
        statements: Vec<RoleSqlTransactionStatement<'_, Self>>,
    ) -> RoleStoreResult<Vec<Self::Outcome>> {
        let mut execution = Vec::with_capacity(statements.len());
        for step in &statements {
            execution.push(match step {
                RoleSqlTransactionStatement::Execute(statement) => (statement, None),
                RoleSqlTransactionStatement::ExpectChanges { statement, count } => {
                    (statement, Some(*count))
                }
            });
        }
        self.execute(&execution).await
    }
}

enum PostgresTransactionError {
    Database(tokio_postgres::Error),
    Store(RoleStoreError),
}

impl From<tokio_postgres::Error> for PostgresTransactionError {
    fn from(error: tokio_postgres::Error) -> Self {
        Self::Database(error)
    }
}

impl From<RoleStoreError> for PostgresTransactionError {
    fn from(error: RoleStoreError) -> Self {
        Self::Store(error)
    }
}

async fn execute_transaction(
    client: &mut Client,
    statements: &[(
        &RoleSqlStatement<'_, PostgresRoleSqlSessionV1>,
        Option<usize>,
    )],
) -> Result<Vec<PostgresRoleSqlOutcomeV1>, PostgresTransactionError> {
    let transaction = client
        .build_transaction()
        .isolation_level(IsolationLevel::Serializable)
        .start()
        .await?;
    // A caller's connection defaults must not weaken acknowledged commit durability.
    transaction
        .batch_execute("SET LOCAL search_path = public, pg_catalog, pg_temp; SET LOCAL synchronous_commit = on")
        .await?;
    let result = execute_statements(&transaction, statements).await;
    match result {
        Ok(outcomes) => {
            transaction.commit().await?;
            Ok(outcomes)
        }
        Err(error) => {
            transaction.rollback().await?;
            Err(error)
        }
    }
}

async fn execute_statements(
    transaction: &Transaction<'_>,
    statements: &[(
        &RoleSqlStatement<'_, PostgresRoleSqlSessionV1>,
        Option<usize>,
    )],
) -> Result<Vec<PostgresRoleSqlOutcomeV1>, PostgresTransactionError> {
    let mut outcomes = Vec::with_capacity(statements.len());
    for (statement, expected) in statements {
        let outcome = execute_statement(transaction, statement).await?;
        if expected.is_some_and(|count| count != outcome.changes) {
            return Err(RoleStoreError::message(
                "PostgreSQL role-store affected-row requirement failed",
            )
            .into());
        }
        outcomes.push(outcome);
    }
    Ok(outcomes)
}

async fn execute_statement(
    transaction: &Transaction<'_>,
    statement: &RoleSqlStatement<'_, PostgresRoleSqlSessionV1>,
) -> Result<PostgresRoleSqlOutcomeV1, PostgresTransactionError> {
    // SQLite permits unused numbered positions. PostgreSQL needs an explicit
    // type for each unused position, while inferring used positions from SQL.
    let mut types = vec![Type::TEXT; statement.params().len()];
    for (_, position) in parameter_positions(statement.sql())? {
        let parameter_type = types.get_mut(position - 1).ok_or_else(|| {
            RoleStoreError::message("role-store SQL parameter exceeds its bindings")
        })?;
        *parameter_type = Type::UNKNOWN;
    }
    let prepared = transaction.prepare_typed(statement.sql(), &types).await?;
    let values = bind_parameters(statement.params(), prepared.params())?;
    let parameters: Vec<&(dyn ToSql + Sync)> = values.iter().map(parameter_ref).collect();
    let stream = transaction.query_raw(&prepared, parameters).await?;
    pin_mut!(stream);
    let mut rows = Vec::new();
    while let Some(row) = stream.try_next().await? {
        rows.push(decode_row(&row)?);
    }
    let changes = usize::try_from(stream.rows_affected().unwrap_or_default())
        .map_err(|_| RoleStoreError::message("PostgreSQL row count exceeds usize"))?;
    Ok(PostgresRoleSqlOutcomeV1 { changes, rows })
}

fn bind_parameters(
    values: &[RoleSqlOwnedValueV1],
    types: &[Type],
) -> RoleStoreResult<Vec<Box<dyn ToSql + Sync + Send>>> {
    let mut parameters: Vec<Box<dyn ToSql + Sync + Send>> = Vec::with_capacity(values.len());
    for (value, parameter_type) in values.iter().zip(types) {
        let text = match value {
            RoleSqlOwnedValueV1::Text(text) => Some(text.as_str()),
            RoleSqlOwnedValueV1::Null => None,
        };
        let parameter: Box<dyn ToSql + Sync + Send> = match *parameter_type {
            Type::TEXT | Type::VARCHAR | Type::BPCHAR => Box::new(text.map(str::to_owned)),
            Type::INT8 => Box::new(parse_integer::<i64>(text)?),
            Type::INT4 => Box::new(parse_integer::<i32>(text)?),
            Type::INT2 => Box::new(parse_integer::<i16>(text)?),
            _ => {
                return Err(RoleStoreError::message(format!(
                    "unsupported role-store parameter type: {parameter_type}"
                )))
            }
        };
        parameters.push(parameter);
    }
    Ok(parameters)
}

fn parse_integer<T: core::str::FromStr>(text: Option<&str>) -> RoleStoreResult<Option<T>> {
    text.map(str::parse)
        .transpose()
        .map_err(|_| RoleStoreError::message("invalid role-store integer parameter"))
}

fn parameter_ref(value: &Box<dyn ToSql + Sync + Send>) -> &(dyn ToSql + Sync) {
    value.as_ref()
}

fn decode_row(row: &Row) -> RoleStoreResult<Value> {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let value = match *column.type_() {
            Type::TEXT | Type::VARCHAR | Type::BPCHAR => serde_json::to_value(
                row.try_get::<_, Option<String>>(index)
                    .map_err(database_error)?,
            ),
            Type::INT8 => serde_json::to_value(
                row.try_get::<_, Option<i64>>(index)
                    .map_err(database_error)?,
            ),
            Type::INT4 => serde_json::to_value(
                row.try_get::<_, Option<i32>>(index)
                    .map_err(database_error)?,
            ),
            Type::INT2 => serde_json::to_value(
                row.try_get::<_, Option<i16>>(index)
                    .map_err(database_error)?,
            ),
            Type::BOOL => serde_json::to_value(
                row.try_get::<_, Option<bool>>(index)
                    .map_err(database_error)?,
            ),
            _ => {
                return Err(RoleStoreError::message(format!(
                    "unsupported role-store result type: {}",
                    column.type_()
                )))
            }
        }?;
        object.insert(column.name().to_owned(), value);
    }
    Ok(Value::Object(object))
}

fn retryable(error: &tokio_postgres::Error) -> bool {
    matches!(
        error.code(),
        Some(&SqlState::T_R_SERIALIZATION_FAILURE | &SqlState::T_R_DEADLOCK_DETECTED)
    )
}

fn database_error(error: tokio_postgres::Error) -> RoleStoreError {
    match error.as_db_error() {
        Some(database) => RoleStoreError::message(format!(
            "PostgreSQL {}: {}",
            database.code().code(),
            database.message()
        )),
        None => RoleStoreError::message(format!("PostgreSQL transport: {error}")),
    }
}
