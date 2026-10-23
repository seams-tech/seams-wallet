use router_ab_cloudflare::{
    CloudflareTenantRootDeriverRoleV1, PostgresRoleSqlSessionV1, RoleSqlOutcomeV1,
    RoleSqlSessionV1, RoleSqlValue,
};
use serde::Deserialize;
use serde_json::json;
use tokio_postgres::{Client, Config, Connection};
use worker::{event, postgres_tls::PassthroughTls, Context, Env, Request, Response, Socket};

const SNAPSHOT_LOCK_KEY: i64 = 315_702;
const LOST_CLAIM_ERROR: &str =
    "PostgreSQL 23514: tenant-root affected-row requirement failed: expected 1, actual 0";

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct ProbeRow {
    value: i64,
    note: String,
}

#[event(fetch)]
async fn main(_request: Request, env: Env, context: Context) -> worker::Result<Response> {
    let result = verify_driver(&env, &context).await;
    match result {
        Ok(evidence) => Response::from_json(&evidence),
        Err(message) => Response::error(message, 500),
    }
}

async fn connect(env: &Env, context: &Context, binding: &str) -> Result<Client, String> {
    let hyperdrive = env.hyperdrive(binding).map_err(describe)?;
    let socket = Socket::builder()
        .secure_transport(worker::SecureTransport::StartTls)
        .connect(hyperdrive.host(), hyperdrive.port())
        .map_err(describe)?;
    let config: Config = hyperdrive.connection_string().parse().map_err(describe)?;
    let (client, connection) = config
        .connect_raw(socket, PassthroughTls)
        .await
        .map_err(describe)?;
    context.wait_until(drive_connection(connection));
    Ok(client)
}

async fn drive_connection(connection: Connection<Socket, Socket>) {
    if connection.await.is_err() {
        worker::console_error!("PostgreSQL fixture connection ended with an error");
    }
}

async fn session(env: &Env, context: &Context) -> Result<PostgresRoleSqlSessionV1, String> {
    PostgresRoleSqlSessionV1::new(
        connect(env, context, "ROLE_A").await?,
        CloudflareTenantRootDeriverRoleV1::DeriverA,
    )
    .await
    .map_err(describe)
}

async fn row(session: &PostgresRoleSqlSessionV1) -> Result<ProbeRow, String> {
    session
        .prepare("SELECT value, note FROM worker_role_probe WHERE id = 'shared'")
        .first(None)
        .await
        .map_err(describe)?
        .ok_or_else(|| "Worker probe row is missing".to_owned())
}

async fn claim(session: &PostgresRoleSqlSessionV1) -> Result<bool, String> {
    match session
        .transaction(vec![session
            .prepare("UPDATE worker_role_probe SET state = 'claimed' WHERE id = 'shared' AND state = 'ready'")
            .expect_changes(1)])
        .await
    {
        Ok(_) => Ok(true),
        Err(error) if error.to_string() == LOST_CLAIM_ERROR => Ok(false),
        Err(error) => Err(describe(error)),
    }
}

async fn snapshot(session: &PostgresRoleSqlSessionV1) -> Result<(ProbeRow, ProbeRow), String> {
    let key = SNAPSHOT_LOCK_KEY.to_string();
    let results = session
        .transaction(vec![
            session
                .prepare("SELECT value, note FROM worker_role_probe WHERE id = 'shared'")
                .into(),
            session
                .prepare("SELECT 1 AS locked FROM pg_advisory_xact_lock($1)")
                .bind_refs([&RoleSqlValue::Text(&key)])
                .map_err(describe)?
                .into(),
            session
                .prepare("SELECT value, note FROM worker_role_probe WHERE id = 'shared'")
                .into(),
        ])
        .await
        .map_err(describe)?;
    let [first, _, last] = results.as_slice() else {
        return Err("Snapshot did not return three outcomes".to_owned());
    };
    let mut first = first.results::<ProbeRow>().map_err(describe)?;
    let mut last = last.results::<ProbeRow>().map_err(describe)?;
    if first.len() != 1 || last.len() != 1 {
        return Err("Snapshot did not return the probe row".to_owned());
    }
    Ok((first.remove(0), last.remove(0)))
}

async fn wait_for_snapshot_reader(client: &Client) -> Result<(), String> {
    for _ in 0..500 {
        let row = client
            .query_one(
                "SELECT COUNT(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid::BIGINT = $1",
                &[&SNAPSHOT_LOCK_KEY],
            )
            .await
            .map_err(describe)?;
        if row.get::<_, i64>(0) > 0 {
            return Ok(());
        }
        worker::Delay::from(std::time::Duration::from_millis(10)).await;
    }
    Err("Snapshot reader did not reach its barrier".to_owned())
}

async fn commit_between_reads(client: &Client) -> Result<(), String> {
    wait_for_snapshot_reader(client).await?;
    let changes = client
        .execute(
            "UPDATE worker_role_probe SET value = value + 1 WHERE id = 'shared'",
            &[],
        )
        .await
        .map_err(describe)?;
    if changes != 1 {
        return Err("Concurrent write did not update the probe row".to_owned());
    }
    Ok(())
}

async fn concurrent_update(client: &Client) -> Result<(), String> {
    let result = commit_between_reads(client).await;
    let released = client
        .query_one("SELECT pg_advisory_unlock($1)", &[&SNAPSHOT_LOCK_KEY])
        .await
        .map_err(describe)?;
    if !released.get::<_, bool>(0) {
        return Err("Snapshot barrier was not held".to_owned());
    }
    result
}

async fn verify_driver(env: &Env, context: &Context) -> Result<serde_json::Value, String> {
    let first = session(env, context).await?;
    let second = session(env, context).await?;
    let role_b = PostgresRoleSqlSessionV1::new(
        connect(env, context, "ROLE_B").await?,
        CloudflareTenantRootDeriverRoleV1::DeriverB,
    )
    .await
    .map_err(describe)?;
    drop(role_b);
    let wrong_role = PostgresRoleSqlSessionV1::new(
        connect(env, context, "ROLE_B").await?,
        CloudflareTenantRootDeriverRoleV1::DeriverA,
    )
    .await;
    match wrong_role {
        Err(error) if error.to_string() == "PostgreSQL role-store identity mismatch" => {}
        Err(error) => return Err(describe(error)),
        Ok(_) => return Err("Role B connection accepted role A identity".to_owned()),
    }

    let note = "Worker 'quoted' \\ value 雪";
    first
        .transaction(vec![first
            .prepare("INSERT INTO worker_role_probe (id, value, note, state) VALUES ('shared', 7, $1, 'ready')")
            .bind_refs([&RoleSqlValue::Text(note)])
            .map_err(describe)?
            .expect_changes(1)])
        .await
        .map_err(describe)?;
    let initial = row(&first).await?;
    if initial.value != 7 || initial.note != note {
        return Err("Bound text or initial value changed".to_owned());
    }

    let refused = first
        .transaction(vec![
            first
                .prepare("UPDATE worker_role_probe SET value = 99 WHERE id = 'shared'")
                .expect_changes(1),
            first
                .prepare("UPDATE worker_role_probe SET value = 99 WHERE id = 'missing'")
                .expect_changes(1),
        ])
        .await;
    if refused.err().map(describe).as_deref() != Some(LOST_CLAIM_ERROR)
        || row(&second).await? != initial
    {
        return Err("Failed conditional mutation did not roll back".to_owned());
    }

    let (claim_first, claim_second) = futures::join!(claim(&first), claim(&second));
    if usize::from(claim_first?) + usize::from(claim_second?) != 1 {
        return Err("Concurrent claims did not choose one winner".to_owned());
    }

    // This local fixture uses a separate connection as a test-only ordering barrier.
    let barrier = connect(env, context, "ROLE_A").await?;
    barrier
        .query_one("SELECT pg_advisory_lock($1)", &[&SNAPSHOT_LOCK_KEY])
        .await
        .map_err(describe)?;
    let (snapshot_result, update_result) =
        futures::join!(snapshot(&first), concurrent_update(&barrier));
    let (before, after) = snapshot_result?;
    update_result?;
    if before != after || before.value != 7 || row(&second).await?.value != 8 {
        return Err("Transaction reads did not retain one snapshot".to_owned());
    }

    let outcomes = first
        .transaction(vec![
            first
                .prepare("UPDATE worker_role_probe SET value = value + 1 WHERE id = 'shared'")
                .expect_changes(1),
            first
                .prepare("SELECT worker_role_probe_retry_once() AS attempt")
                .into(),
        ])
        .await
        .map_err(describe)?;
    let [_, attempt] = outcomes.as_slice() else {
        return Err("Retried transaction returned the wrong outcomes".to_owned());
    };
    let attempts = attempt.results::<serde_json::Value>().map_err(describe)?;
    if attempts != vec![json!({ "attempt": 2 })] || row(&second).await?.value != 9 {
        return Err(
            "Serialization retry did not roll back and repeat the complete transaction".to_owned(),
        );
    }
    drop(first);
    drop(second);
    let reconnected = session(env, context).await?;
    if row(&reconnected).await?.value != 9 {
        return Err("Committed result did not survive reconnection".to_owned());
    }
    Ok(json!({
        "kind": "postgres_role_worker_contract_v1",
        "transport": "workerd Hyperdrive binding and Workers socket",
        "wrongRoleRejected": true,
        "quotedTextPreserved": true,
        "conditionalFailureRolledBack": true,
        "concurrentClaimWinners": 1,
        "coherentSnapshot": true,
        "serializationAttempts": 2,
        "valueAfterReconnect": 9,
    }))
}

fn describe(error: impl std::fmt::Display) -> String {
    error.to_string()
}
