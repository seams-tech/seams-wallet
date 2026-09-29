//! A VM role's read-only deployment check: `router_ab_local_worker --check`.
//!
//! The check reads only the role's own env file and SQLite files, and asks
//! each peer the role is configured to call only for its health answer. It
//! generates no key, applies no migration, creates no database and repairs
//! nothing. What it cannot establish it reports as unverified, never as
//! passed. It prints no configuration value except URLs and file paths.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;

use router_ab_core::{LocalServiceRoleV1, RouterAbProtocolResult};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    local_signing_worker_near_sqlite, local_tenant_root_role_sql, LocalDeriverTenantRootConfigV1,
    LocalSqliteMigrationV1, LocalWorkerRoleConfigV1, LOCAL_DERIVER_A_ROLE_PRIVATE_MIGRATIONS_V1,
    LOCAL_DERIVER_B_ROLE_PRIVATE_MIGRATIONS_V1, LOCAL_MANAGED_BACKUP_MIGRATIONS_V1,
    LOCAL_ROUTER_CREATION_STATE_MIGRATIONS_V1,
};

use LocalDeploymentCheckStatusV1::{Failed, Passed, Unverified};

/// The report's `kind`.
pub const LOCAL_DEPLOYMENT_CHECK_REPORT_KIND_V1: &str = "router_ab_local_deployment_check_v1";

/// One check's outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalDeploymentCheckStatusV1 {
    Passed,
    Failed,
    /// The check cannot establish this with the role's own configuration
    /// and permissions.
    Unverified,
}

/// One named check and what it found.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LocalDeploymentCheckItemV1 {
    pub check: String,
    pub status: LocalDeploymentCheckStatusV1,
    pub detail: Value,
}

/// Everything one role's check found. `passed` is false when any check failed.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LocalDeploymentCheckReportV1 {
    pub kind: &'static str,
    pub role: &'static str,
    pub build: &'static str,
    pub env_path: String,
    pub passed: bool,
    pub checks: Vec<LocalDeploymentCheckItemV1>,
}

/// One SQLite file a role owns: the schema chain `--migrate` applies to it,
/// if it has one. A role's own code creates further tables on first use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalRoleSqliteStoreV1 {
    pub label: &'static str,
    pub path: PathBuf,
    pub chain: Option<&'static [LocalSqliteMigrationV1]>,
}

/// The SQLite files one role owns.
pub fn local_worker_role_sqlite_stores_v1(
    config: &LocalWorkerRoleConfigV1,
) -> Vec<LocalRoleSqliteStoreV1> {
    let store = |label, path: &Path, chain| LocalRoleSqliteStoreV1 {
        label,
        path: path.to_path_buf(),
        chain,
    };
    match config {
        LocalWorkerRoleConfigV1::Router(router) => vec![store(
            "creation_state",
            &router.tenant_root.creation_storage_path,
            Some(LOCAL_ROUTER_CREATION_STATE_MIGRATIONS_V1),
        )],
        LocalWorkerRoleConfigV1::DeriverA(deriver) => vec![
            store(
                "role_private_store",
                Path::new(&deriver.role_private_storage_path),
                Some(LOCAL_DERIVER_A_ROLE_PRIVATE_MIGRATIONS_V1),
            ),
            store(
                "managed_backups",
                &deriver.tenant_root.managed_backup_path,
                Some(LOCAL_MANAGED_BACKUP_MIGRATIONS_V1),
            ),
        ],
        LocalWorkerRoleConfigV1::DeriverB(deriver) => vec![
            store(
                "role_private_store",
                Path::new(&deriver.role_private_storage_path),
                Some(LOCAL_DERIVER_B_ROLE_PRIVATE_MIGRATIONS_V1),
            ),
            store(
                "managed_backups",
                &deriver.tenant_root.managed_backup_path,
                Some(LOCAL_MANAGED_BACKUP_MIGRATIONS_V1),
            ),
        ],
        LocalWorkerRoleConfigV1::SigningWorker(signing_worker) => vec![store(
            "role_private_store",
            Path::new(&signing_worker.role_private_storage_path),
            None,
        )],
    }
}

/// Runs every check for one role from its env file.
pub fn local_worker_deployment_check_v1(
    role: LocalServiceRoleV1,
    env_path: &Path,
) -> LocalDeploymentCheckReportV1 {
    let mut checks = Vec::new();
    match read_role_config(role, env_path) {
        Ok((config, keys)) => {
            checks.push(item("configuration", Passed, json!({ "keys": keys })));
            for store in local_worker_role_sqlite_stores_v1(&config) {
                checks.push(storage_check(&config, &store));
            }
            checks.push(self_address_check(&config));
            for (peer, url) in configured_peers(&config) {
                checks.push(peer_check(peer, url));
            }
            checks.extend(durable_job_check(&config));
        }
        Err(error) => checks.push(item("configuration", Failed, json!({ "error": error }))),
    }
    checks.push(item(
        "peer_authentication",
        Unverified,
        json!({
            "reason": "the check sends no credential; a peer that refuses this role's service credentials is found only by an authenticated call, such as the explicit smoke test",
        }),
    ));
    checks.push(item(
        "custody_isolation",
        Unverified,
        json!({
            "operator_review": "separate hosts, administrators, service identities, keys, databases and backups for Deriver A and Deriver B; a role's own check cannot establish them",
        }),
    ));
    LocalDeploymentCheckReportV1 {
        kind: LOCAL_DEPLOYMENT_CHECK_REPORT_KIND_V1,
        role: role.as_str(),
        build: env!("CARGO_PKG_VERSION"),
        env_path: env_path.display().to_string(),
        passed: checks.iter().all(|check| check.status != Failed),
        checks,
    }
}

fn item(
    check: impl Into<String>,
    status: LocalDeploymentCheckStatusV1,
    detail: Value,
) -> LocalDeploymentCheckItemV1 {
    LocalDeploymentCheckItemV1 {
        check: check.into(),
        status,
        detail,
    }
}

/// The role's config, parsed as the role parses it at startup, and how many
/// keys its env file sets. The parser's errors name keys, never values.
fn read_role_config(
    role: LocalServiceRoleV1,
    env_path: &Path,
) -> Result<(LocalWorkerRoleConfigV1, usize), String> {
    let contents = std::fs::read_to_string(env_path)
        .map_err(|error| format!("the env file cannot be read: {error}"))?;
    let entries =
        crate::parse_local_env_file_contents_v1(&contents).map_err(|error| error.to_string())?;
    let keys = entries.len();
    let config = crate::parse_local_worker_role_config_for_role_v1(role, entries)
        .map_err(|error| error.to_string())?;
    Ok((config, keys))
}

/// A SQLite schema object's type and name, and its SQL as SQLite stores it.
type SchemaObjectsV1 = BTreeMap<(String, String), Option<String>>;

/// One store against what this build creates in it. A store with a chain
/// must carry exactly the chain, applied in full, and nothing it does not
/// ship. Tables the role creates on first use may be absent, but a present
/// one must match this build's.
fn storage_check(
    config: &LocalWorkerRoleConfigV1,
    store: &LocalRoleSqliteStoreV1,
) -> LocalDeploymentCheckItemV1 {
    let check = format!("storage:{}", store.label);
    let path = store.path.display().to_string();
    if !store.path.exists() {
        return match store.chain {
            Some(_) => item(
                check,
                Failed,
                json!({ "path": path, "state": "missing", "action": "apply the role's schema with --migrate" }),
            ),
            None => item(
                check,
                Unverified,
                json!({
                    "path": path,
                    "state": "missing",
                    "note": "the role creates this file when it first starts; once it holds wallet material, it must be found here",
                }),
            ),
        };
    }
    match inspect_store(config, store) {
        Ok((status, detail)) => item(check, status, json!({ "path": path, "found": detail })),
        Err(error) => item(check, Failed, json!({ "path": path, "error": error })),
    }
}

fn inspect_store(
    config: &LocalWorkerRoleConfigV1,
    store: &LocalRoleSqliteStoreV1,
) -> Result<(LocalDeploymentCheckStatusV1, Value), String> {
    let mut detail = serde_json::Map::new();
    if let Some(chain) = store.chain {
        let status = crate::local_sqlite_migration_status_v1(&store.path, chain)
            .map_err(|error| error.to_string())?;
        detail.insert("shipped".into(), json!(chain.last().map(|(name, _)| *name)));
        detail.insert("applied".into(), json!(status.applied.len()));
        if !status.is_current() {
            detail.insert("pending".into(), json!(status.pending));
            detail.insert("unknown".into(), json!(status.unknown));
            detail.insert(
                "action".into(),
                json!(if status.unknown.is_empty() {
                    "apply the pending migrations with --migrate"
                } else {
                    "this file carries migrations this build does not ship: run the build that applied them"
                }),
            );
            return Ok((Failed, Value::Object(detail)));
        }
    }
    let (chain_objects, first_use_objects) =
        expected_schema(config, store).map_err(|error| error.to_string())?;
    let connection = open_read_only(&store.path)?;
    let found = read_schema_objects(&connection).map_err(|error| error.to_string())?;
    let mut missing = Vec::new();
    let mut incompatible = Vec::new();
    let mut created_at_first_use = Vec::new();
    for (key, sql) in &chain_objects {
        match found.get(key) {
            None => missing.push(key.1.clone()),
            Some(found_sql) if found_sql != sql => incompatible.push(key.1.clone()),
            Some(_) => {}
        }
    }
    for (key, sql) in &first_use_objects {
        match found.get(key) {
            None => created_at_first_use.push(key.1.clone()),
            Some(found_sql) if found_sql != sql => incompatible.push(key.1.clone()),
            Some(_) => {}
        }
    }
    let unexpected: Vec<String> = found
        .keys()
        .filter(|key| !chain_objects.contains_key(*key) && !first_use_objects.contains_key(*key))
        .map(|key| key.1.clone())
        .collect();
    detail.insert("rows".into(), json!(table_rows(&connection, &found)?));
    if !created_at_first_use.is_empty() {
        detail.insert("created_at_first_use".into(), json!(created_at_first_use));
    }
    if missing.is_empty() && incompatible.is_empty() && unexpected.is_empty() {
        return Ok((Passed, Value::Object(detail)));
    }
    detail.insert("missing".into(), json!(missing));
    detail.insert("incompatible".into(), json!(incompatible));
    detail.insert("unexpected".into(), json!(unexpected));
    detail.insert(
        "action".into(),
        json!("this file does not hold the schema this build gives the role: check that the path names this role's own store"),
    );
    Ok((Failed, Value::Object(detail)))
}

/// What this build creates in one store: the objects its chain creates, and
/// those the role's own code creates on first use. Built in memory with the
/// statements the role itself runs.
fn expected_schema(
    config: &LocalWorkerRoleConfigV1,
    store: &LocalRoleSqliteStoreV1,
) -> RouterAbProtocolResult<(SchemaObjectsV1, SchemaObjectsV1)> {
    let mut connection = Connection::open_in_memory().map_err(schema_error)?;
    if let Some(chain) = store.chain {
        local_tenant_root_role_sql::apply_local_sqlite_migrations_on_connection_v1(
            &mut connection,
            chain,
        )
        .map_err(|error| {
            router_ab_core::RouterAbProtocolError::new(
                router_ab_core::RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
                error.to_string(),
            )
        })?;
    }
    let chain_objects = read_schema_objects(&connection).map_err(schema_error)?;
    match (config, store.label) {
        (LocalWorkerRoleConfigV1::DeriverA(_), "role_private_store") => {
            crate::ensure_local_role_private_sqlite_schema_v1(&connection)?;
            crate::local_ed25519_yao_pair_sqlite::ensure_local_deriver_a_pair_schema_v1(
                &connection,
            )?;
        }
        (LocalWorkerRoleConfigV1::DeriverB(_), "role_private_store") => {
            crate::ensure_local_role_private_sqlite_schema_v1(&connection)?;
            crate::local_ed25519_yao_sqlite_host::ensure_local_deriver_b_pair_schema_v1(
                &connection,
            )?;
        }
        (LocalWorkerRoleConfigV1::SigningWorker(signing_worker), "role_private_store") => {
            crate::ensure_local_role_private_sqlite_schema_v1(&connection)?;
            local_signing_worker_near_sqlite::ensure_schema(&connection)?;
            crate::local_signing_worker_wallet_sqlite::ensure_local_signing_worker_wallet_schema_v1(
                &connection,
                signing_worker,
            )?;
        }
        _ => {}
    }
    let first_use_objects = read_schema_objects(&connection)
        .map_err(schema_error)?
        .into_iter()
        .filter(|(key, _)| !chain_objects.contains_key(key))
        .collect();
    Ok((chain_objects, first_use_objects))
}

fn schema_error(error: rusqlite::Error) -> router_ab_core::RouterAbProtocolError {
    router_ab_core::RouterAbProtocolError::new(
        router_ab_core::RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        format!("the schema this build expects could not be built: {error}"),
    )
}

/// Opens a role's file without write access. SQLite may still create the
/// WAL index files beside a WAL-mode database it reads; they hold no data.
fn open_read_only(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("the file cannot be opened read-only: {error}"))
}

fn read_schema_objects(connection: &Connection) -> rusqlite::Result<SchemaObjectsV1> {
    let mut statement = connection.prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            (row.get::<_, String>(0)?, row.get::<_, String>(1)?),
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    rows.collect()
}

/// Row counts of the tables that hold rows. Counts only: no row is read.
fn table_rows(
    connection: &Connection,
    objects: &SchemaObjectsV1,
) -> Result<BTreeMap<String, i64>, String> {
    let mut rows = BTreeMap::new();
    for (kind, name) in objects.keys() {
        if kind != "table" {
            continue;
        }
        let count: i64 = connection
            .query_row(
                &format!("SELECT COUNT(*) FROM \"{}\"", name.replace('"', "\"\"")),
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("table {name} cannot be counted: {error}"))?;
        if count > 0 {
            rows.insert(name.clone(), count);
        }
    }
    Ok(rows)
}

/// The peers a role calls, by the role each must be, and the URL it is
/// configured at.
fn configured_peers(config: &LocalWorkerRoleConfigV1) -> Vec<(&'static str, &str)> {
    match config {
        LocalWorkerRoleConfigV1::Router(router) => vec![
            ("deriver_a", router.deriver_a_url.as_str()),
            ("deriver_b", router.deriver_b_url.as_str()),
            ("signing_worker", router.signing_worker_url.as_str()),
            (
                "tenant_root_control_plane",
                router.tenant_root.control_plane_url.as_str(),
            ),
        ],
        LocalWorkerRoleConfigV1::DeriverA(deriver) => vec![
            ("deriver_b", deriver.deriver_b_url.as_str()),
            ("router", deriver.tenant_root.router_url.as_str()),
        ],
        LocalWorkerRoleConfigV1::DeriverB(deriver) => vec![
            ("deriver_a", deriver.deriver_a_url.as_str()),
            ("router", deriver.tenant_root.router_url.as_str()),
        ],
        LocalWorkerRoleConfigV1::SigningWorker(_) => Vec::new(),
    }
}

fn peer_check(peer: &'static str, url: &str) -> LocalDeploymentCheckItemV1 {
    let check = format!("peer:{peer}");
    match health_role(url) {
        Ok(role) if role == peer => item(check, Passed, json!({ "url": url })),
        Ok(role) => item(
            check,
            Failed,
            json!({ "url": url, "answered_as": role, "action": "point this URL at the role it names" }),
        ),
        Err(HealthErrorV1::Unreachable(error)) => item(
            check,
            Failed,
            json!({ "url": url, "state": "unreachable", "error": error }),
        ),
        Err(HealthErrorV1::Answer(error)) => {
            item(check, Failed, json!({ "url": url, "error": error }))
        }
    }
}

/// The role's own address: serving as this role, not serving yet, or taken
/// by something else.
fn self_address_check(config: &LocalWorkerRoleConfigV1) -> LocalDeploymentCheckItemV1 {
    let url = config.bind_url();
    let role = config.role().as_str();
    match health_role(url) {
        Ok(answered) if answered == role => {
            item("address", Passed, json!({ "url": url, "state": "serving" }))
        }
        Ok(answered) => item(
            "address",
            Failed,
            json!({ "url": url, "answered_as": answered, "action": "another role serves this role's address" }),
        ),
        Err(HealthErrorV1::Unreachable(_)) => item(
            "address",
            Unverified,
            json!({ "url": url, "state": "not serving", "note": "start the role and run the check again to verify it serves here" }),
        ),
        Err(HealthErrorV1::Answer(error)) => {
            item("address", Failed, json!({ "url": url, "error": error }))
        }
    }
}

enum HealthErrorV1 {
    Unreachable(String),
    Answer(String),
}

/// The role a URL's health endpoint answers as. Sends no credential.
fn health_role(url: &str) -> Result<String, HealthErrorV1> {
    let authority = crate::parse_http_bind_addr_v1(url)
        .map_err(|error| HealthErrorV1::Answer(error.to_string()))?;
    let address = authority
        .to_socket_addrs()
        .map_err(|error| HealthErrorV1::Unreachable(error.to_string()))?
        .next()
        .ok_or_else(|| HealthErrorV1::Unreachable("the host has no address".into()))?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
        .map_err(|error| HealthErrorV1::Unreachable(error.to_string()))?;
    let answer = health_exchange(&mut stream, &authority)
        .map_err(|error| HealthErrorV1::Answer(format!("the health request failed: {error}")))?;
    let answer = String::from_utf8_lossy(&answer);
    let (head, body) = answer
        .split_once("\r\n\r\n")
        .ok_or_else(|| HealthErrorV1::Answer("the health answer is not HTTP".into()))?;
    let status = head.split_whitespace().nth(1).unwrap_or_default();
    if status != "200" {
        return Err(HealthErrorV1::Answer(format!(
            "the health endpoint answered HTTP {status}"
        )));
    }
    let body: Value = serde_json::from_str(body.trim())
        .map_err(|_| HealthErrorV1::Answer("the health answer is not JSON".into()))?;
    body.get("role_label")
        .or_else(|| body.get("role"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| HealthErrorV1::Answer("the health answer names no role".into()))
}

fn health_exchange(stream: &mut TcpStream, authority: &str) -> std::io::Result<Vec<u8>> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    write!(
        stream,
        "GET {} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n",
        crate::LOCAL_WORKER_HEALTH_PATH
    )?;
    let mut answer = Vec::new();
    stream.take(64 * 1024).read_to_end(&mut answer)?;
    Ok(answer)
}

/// The settings the role's durable jobs run on, parsed by the code that
/// runs them, and for the Router the tenant roots its scheduler offers a
/// refresh.
fn durable_job_check(config: &LocalWorkerRoleConfigV1) -> Option<LocalDeploymentCheckItemV1> {
    match config {
        LocalWorkerRoleConfigV1::Router(router) => {
            let settings = (|| -> RouterAbProtocolResult<Value> {
                let schedule = router_ab_cloudflare::parse_tenant_root_refresh_schedule_v1(
                    &router.tenant_root.env,
                )?;
                Ok(json!({
                    "scheduled_refresh_interval_ms": schedule.scheduled_interval_ms,
                    "manual_refresh_interval_ms": schedule.manual_interval_ms,
                    "scheduler_tick_ms": crate::local_tenant_root_refresh_scheduler_tick_ms_v1(&router.tenant_root)?,
                    "retirement_grace_ms": router_ab_cloudflare::parse_tenant_root_retirement_grace_ms_v1(&router.tenant_root.env)?,
                }))
            })();
            Some(match settings {
                Ok(mut settings) => {
                    settings["tenant_roots"] =
                        tenant_roots_held(&router.tenant_root.creation_storage_path);
                    item("durable_jobs", Passed, settings)
                }
                Err(error) => item(
                    "durable_jobs",
                    Failed,
                    json!({ "error": error.to_string() }),
                ),
            })
        }
        LocalWorkerRoleConfigV1::DeriverA(deriver) => Some(deriver_job_check(&deriver.tenant_root)),
        LocalWorkerRoleConfigV1::DeriverB(deriver) => Some(deriver_job_check(&deriver.tenant_root)),
        LocalWorkerRoleConfigV1::SigningWorker(_) => None,
    }
}

fn deriver_job_check(tenant_root: &LocalDeriverTenantRootConfigV1) -> LocalDeploymentCheckItemV1 {
    match crate::local_tenant_root_admission_recovery_window_ms_v1(tenant_root) {
        Ok(window_ms) => item(
            "durable_jobs",
            Passed,
            json!({ "admission_recovery_window_ms": window_ms }),
        ),
        Err(error) => item(
            "durable_jobs",
            Failed,
            json!({ "error": error.to_string() }),
        ),
    }
}

/// How many tenant roots the Router's scheduler offers a refresh, or null
/// when its store cannot be read.
fn tenant_roots_held(path: &Path) -> Value {
    if !path.exists() {
        return Value::Null;
    }
    open_read_only(path)
        .ok()
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM local_tenant_root_creation_state WHERE storage_key = ?1",
                    [router_ab_cloudflare::TENANT_ROOT_REFRESH_ACTIVE_STATE_STORAGE_KEY_V1],
                    |row| row.get::<_, i64>(0),
                )
                .ok()
        })
        .map_or(Value::Null, Value::from)
}
