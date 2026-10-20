use super::{
    RoleSqlOutcomeV1, RoleSqlOwnedValueV1, RoleSqlReadV1, RoleSqlSessionV1, RoleSqlStatement,
    RoleSqlTransactionStatement, RoleStoreError, RoleStoreResult,
};
use serde::de::DeserializeOwned;

// The existing role-private schema seeds guard_id = 1 and prevents its deletion.
// A mismatch violates that row's primary key and aborts the entire D1 batch.
const CAS_COUNT_GUARD_SQL: &str = "INSERT INTO tenant_root_command_cas_guard (guard_id) \
    SELECT 1 WHERE changes() <> CAST(?1 AS INTEGER)";

impl From<worker::Error> for RoleStoreError {
    fn from(error: worker::Error) -> Self {
        Self::message(error.to_string())
    }
}

impl From<RoleStoreError> for worker::Error {
    fn from(error: RoleStoreError) -> Self {
        worker::Error::RustError(error.to_string())
    }
}

/// The role-private D1 driver. Rows retain D1's deserialization.
pub struct D1RoleSqlSessionV1 {
    session: worker::D1DatabaseSession,
}

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

    async fn transaction(
        &self,
        statements: Vec<RoleSqlTransactionStatement<'_, Self>>,
    ) -> RoleStoreResult<Vec<worker::D1Result>> {
        let mut prepared = Vec::new();
        for statement in &statements {
            match statement {
                RoleSqlTransactionStatement::Execute(statement) => {
                    prepared.push(self.d1_statement(statement)?);
                }
                RoleSqlTransactionStatement::ExpectChanges { statement, count } => {
                    prepared.push(self.d1_statement(statement)?);
                    let count = count.to_string();
                    // Keep the guard adjacent to its mutation: changes() refers
                    // to the last mutation. D1 must check it before commit.
                    prepared.push(
                        self.session
                            .prepare(CAS_COUNT_GUARD_SQL)
                            .bind_refs([worker::D1Type::Text(&count)].iter())?,
                    );
                }
            }
        }
        let expected_results = prepared.len();
        let results = self.session.batch(prepared).await?;
        if results.len() != expected_results {
            return Err(RoleStoreError::message(
                "role-store D1 transaction returned an invalid result count",
            ));
        }
        let mut results = results.into_iter();
        let mut outcomes = Vec::with_capacity(statements.len());
        for statement in statements {
            let outcome = next_successful_result(&mut results)?;
            if let RoleSqlTransactionStatement::ExpectChanges { .. } = statement {
                let guard = next_successful_result(&mut results)?;
                if guard.changes()? != 0 {
                    return Err(RoleStoreError::message(
                        "role-store D1 row-count guard changed a row",
                    ));
                }
            }
            outcomes.push(outcome);
        }
        Ok(outcomes)
    }
}

fn next_successful_result(
    results: &mut impl Iterator<Item = worker::D1Result>,
) -> RoleStoreResult<worker::D1Result> {
    let result = results
        .next()
        .ok_or_else(|| RoleStoreError::message("role-store D1 transaction omitted a result"))?;
    if !result.success() {
        return Err(RoleStoreError::message(
            result
                .error()
                .unwrap_or_else(|| "role-store D1 transaction failed".to_owned()),
        ));
    }
    Ok(result)
}
