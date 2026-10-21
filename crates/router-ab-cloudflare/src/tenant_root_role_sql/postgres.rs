use super::{
    parameter_positions, RoleSqlOutcomeV1, RoleSqlOwnedValueV1, RoleSqlReadV1, RoleSqlSessionV1,
    RoleSqlStatement, RoleSqlTransactionStatement, RoleStoreError, RoleStoreResult,
};
use crate::CloudflareTenantRootDeriverRoleV1;
use postgres_protocol::escape::escape_literal;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::Mutex;
use tokio_postgres::{error::SqlState, Client, SimpleQueryMessage};

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
            .query_typed_one("SELECT public.tenant_root_store_role()", &[])
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
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        let sql = transaction_sql(statements)?;
        for attempt in 0..=SERIALIZATION_RETRIES {
            let result = {
                let client = self.client.lock().await;
                client.simple_query(&sql).await
            };
            match result {
                Ok(messages) => return decode_outcomes(messages, statements.len()),
                Err(error) if retryable(&error) && attempt < SERIALIZATION_RETRIES => {
                    tokio::time::sleep(std::time::Duration::from_millis(5 << attempt)).await;
                }
                Err(error) => return Err(database_error(error)),
            }
        }
        unreachable!("every transaction attempt returns or retries")
    }
}

/// Fully decoded outcomes return only after the transaction commits.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
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

fn transaction_sql(
    statements: &[(
        &RoleSqlStatement<'_, PostgresRoleSqlSessionV1>,
        Option<usize>,
    )],
) -> RoleStoreResult<String> {
    // PostgreSQL executes one Simple Query message as one implicit transaction.
    // Errors roll back the entire message. ReadyForQuery acknowledges its commit.
    let mut batch = String::from(
        "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; \
         SET LOCAL search_path = public, pg_catalog, pg_temp; \
         SET LOCAL synchronous_commit = on; ",
    );
    for (statement, expected) in statements {
        let sql = bind_sql(statement)?;
        let sql = sql.trim().trim_end_matches(';');
        match sql.split_whitespace().next() {
            Some("SELECT") if expected.is_none() => {
                batch.push_str(&format!(
                    "SELECT json_build_object('changes', 0, 'rows', \
                     COALESCE(json_agg(row_to_json(role_store_row)), '[]'::JSON))::TEXT \
                     FROM ({sql}) AS role_store_row; "
                ));
            }
            Some("INSERT" | "UPDATE" | "DELETE") => {
                let changes = match expected {
                    Some(count) => {
                        let count = i64::try_from(*count).map_err(|_| {
                            RoleStoreError::message("role-store row count exceeds BIGINT")
                        })?;
                        format!("public.require_tenant_root_row_count(COUNT(*), {count})")
                    }
                    None => "COUNT(*)".to_owned(),
                };
                batch.push_str(&format!(
                    "WITH role_store_changes AS ({sql} RETURNING 1) \
                     SELECT json_build_object('changes', {changes}, 'rows', '[]'::JSON)::TEXT \
                     FROM role_store_changes; "
                ));
            }
            _ => {
                return Err(RoleStoreError::message(
                    "role store requires SELECT or a non-returning INSERT, UPDATE, or DELETE",
                ));
            }
        }
    }
    Ok(batch)
}

fn bind_sql(statement: &RoleSqlStatement<'_, PostgresRoleSqlSessionV1>) -> RoleStoreResult<String> {
    let mut sql = String::new();
    let mut previous = 0;
    for (range, position) in parameter_positions(statement.sql())? {
        sql.push_str(&statement.sql()[previous..range.start]);
        let value = statement.params().get(position - 1).ok_or_else(|| {
            RoleStoreError::message("role-store SQL parameter exceeds its bindings")
        })?;
        match value {
            RoleSqlOwnedValueV1::Null => sql.push_str("NULL"),
            RoleSqlOwnedValueV1::Text(text) => {
                if text.contains('\0') {
                    return Err(RoleStoreError::message("PostgreSQL text contains NUL"));
                }
                sql.push_str(&escape_literal(text));
            }
        }
        previous = range.end;
    }
    sql.push_str(&statement.sql()[previous..]);
    Ok(sql)
}

fn decode_outcomes(
    messages: Vec<SimpleQueryMessage>,
    expected_count: usize,
) -> RoleStoreResult<Vec<PostgresRoleSqlOutcomeV1>> {
    let mut outcomes = Vec::with_capacity(expected_count);
    for message in messages {
        if let SimpleQueryMessage::Row(row) = message {
            let encoded = row
                .try_get(0)
                .map_err(database_error)?
                .ok_or_else(|| RoleStoreError::message("PostgreSQL role-store outcome is NULL"))?;
            if row.len() != 1 {
                return Err(RoleStoreError::message(format!(
                    "PostgreSQL role-store outcome has {} columns",
                    row.len()
                )));
            }
            outcomes.push(serde_json::from_str(encoded)?);
        }
    }
    if outcomes.len() != expected_count {
        return Err(RoleStoreError::message(
            "PostgreSQL role-store outcome count differs from its batch",
        ));
    }
    Ok(outcomes)
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
