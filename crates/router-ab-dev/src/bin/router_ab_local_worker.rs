use router_ab_core::LocalServiceRoleV1;
use router_ab_dev::{
    apply_local_sqlite_migrations_v1, dispatch_local_ed25519_yao_connection_with_persistence_v1,
    local_sqlite_migration_status_v1, local_tenant_root_route_v1, LocalSqliteMigrationV1,
    LOCAL_DERIVER_A_ROLE_PRIVATE_MIGRATIONS_V1, LOCAL_DERIVER_B_ROLE_PRIVATE_MIGRATIONS_V1,
    LOCAL_MANAGED_BACKUP_MIGRATIONS_V1, LOCAL_ROUTER_CREATION_STATE_MIGRATIONS_V1,
    local_dev_http_handle_request_with_dispatcher_v1, local_worker_bind_addr_v1,
    parse_local_env_file_contents_v1, parse_local_service_role_label_v1,
    parse_local_worker_role_config_for_role_v1, read_local_dev_http_request_v1,
    write_local_dev_http_response_v1, LocalDevHttpTopologyV1, LocalEd25519YaoConnectionDispatchV1,
    LocalEd25519YaoSqliteHostV1, LocalEd25519YaoWorkerStateV1, LocalRouterEd25519YaoCoordinatorV1,
    LocalRouterRequestDispatcherV1, LocalWorkerRoleConfigV1,
};
use serde::Serialize;
use std::{
    env, fs,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::Arc,
    thread,
};

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkerOptions {
    role: LocalServiceRoleV1,
    env_path: PathBuf,
    migrate: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct WorkerStartupSummary {
    role: LocalServiceRoleV1,
    role_label: String,
    bind_addr: String,
    env_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct WorkerRequestErrorSummary {
    role: LocalServiceRoleV1,
    role_label: String,
    event: &'static str,
    error: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let options = parse_args(env::args().skip(1))?;
    let env_contents = fs::read_to_string(&options.env_path)?;
    let config = Arc::new(parse_local_worker_role_config_for_role_v1(
        options.role,
        parse_local_env_file_contents_v1(&env_contents)?,
    )?);
    let schemas = role_sqlite_schemas(&config);
    if options.migrate {
        for (path, chain) in &schemas {
            let applied = apply_local_sqlite_migrations_v1(path, chain)?;
            eprintln!(
                "{}",
                serde_json::json!({
                    "event": "migrated",
                    "role": config.role().as_str(),
                    "path": path.display().to_string(),
                    "applied": applied,
                })
            );
        }
        return Ok(());
    }
    for (path, chain) in &schemas {
        let status = local_sqlite_migration_status_v1(path, chain)?;
        if !status.is_current() {
            return Err(format!(
                "{} schema is not current (pending {:?}, unknown {:?}); run with --migrate first",
                path.display(),
                status.pending,
                status.unknown
            )
            .into());
        }
    }
    let bind_addr = local_worker_bind_addr_v1(&config)?;
    let listener = TcpListener::bind(&bind_addr)?;
    let state_store = if config.role() == LocalServiceRoleV1::Router {
        None
    } else {
        Some(LocalEd25519YaoSqliteHostV1::open(&config)?)
    };

    let summary = WorkerStartupSummary {
        role: config.role(),
        role_label: config.role().as_str().to_owned(),
        bind_addr: bind_addr.clone(),
        env_path: options.env_path.display().to_string(),
    };
    eprintln!("{}", serde_json::to_string(&summary)?);

    if config.role() == LocalServiceRoleV1::Router {
        // The Router serves creation-state calls from the control plane and
        // both Derivers while its own creation coordinator is waiting on
        // them, so each connection gets its own thread. The Router keeps no
        // in-memory state; its durable state is in SQLite.
        let dispatcher = Arc::new(LocalRouterEd25519YaoCoordinatorV1::default());
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let config = Arc::clone(&config);
                    let dispatcher = Arc::clone(&dispatcher);
                    thread::spawn(move || {
                        if let Err(error) = handle_connection(
                            stream,
                            &config,
                            None,
                            None,
                            Some(dispatcher.as_ref() as &dyn LocalRouterRequestDispatcherV1),
                        ) {
                            log_worker_request_error(&config, error.as_ref());
                        }
                    });
                }
                Err(error) => log_worker_request_error(&config, &error),
            }
        }
        return Ok(());
    }

    let mut yao_state = state_store
        .as_ref()
        .map(|store| store.load_state(config.role()))
        .transpose()?;
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                match handle_connection(
                    stream,
                    &config,
                    yao_state.as_mut(),
                    state_store.as_ref(),
                    None,
                ) {
                    Ok(LocalWorkerConnectionResultV1::YaoHandled) => {
                        if let (Some(store), Some(state)) =
                            (state_store.as_ref(), yao_state.as_ref())
                        {
                            store.persist_state(config.role(), state)?;
                        }
                    }
                    Ok(LocalWorkerConnectionResultV1::YaoNoSnapshotWrite) => {}
                    Ok(LocalWorkerConnectionResultV1::OtherHandled) => {}
                    Err(error) => log_worker_request_error(&config, error.as_ref()),
                }
            }
            Err(error) => log_worker_request_error(&config, &error),
        }
    }
    Ok(())
}

enum LocalWorkerConnectionResultV1 {
    YaoHandled,
    YaoNoSnapshotWrite,
    OtherHandled,
}

fn handle_connection(
    stream: TcpStream,
    config: &LocalWorkerRoleConfigV1,
    yao_state: Option<&mut LocalEd25519YaoWorkerStateV1>,
    state_store: Option<&LocalEd25519YaoSqliteHostV1>,
    router_dispatcher: Option<&dyn LocalRouterRequestDispatcherV1>,
) -> Result<LocalWorkerConnectionResultV1, Box<dyn std::error::Error>> {
    let mut stream = if let Some(yao_state) = yao_state {
        let store = state_store.ok_or("custody worker SQLite host is missing")?;
        let mut persist_before_network = |state: &LocalEd25519YaoWorkerStateV1| {
            store
                .persist_state(config.role(), state)
                .map_err(Into::into)
        };
        match dispatch_local_ed25519_yao_connection_with_persistence_v1(
            stream,
            config,
            yao_state,
            store,
            &mut persist_before_network,
        )? {
            LocalEd25519YaoConnectionDispatchV1::Handled => {
                return Ok(LocalWorkerConnectionResultV1::YaoHandled);
            }
            LocalEd25519YaoConnectionDispatchV1::NoSnapshotWrite => {
                return Ok(LocalWorkerConnectionResultV1::YaoNoSnapshotWrite);
            }
            LocalEd25519YaoConnectionDispatchV1::Unhandled(stream) => stream,
        }
    } else {
        stream
    };
    let request = read_local_dev_http_request_v1(&mut stream)?;
    if let Some((status, body)) = local_tenant_root_route_v1(config, &request) {
        write_local_dev_http_response_v1(&mut stream, status, &body)?;
        return Ok(LocalWorkerConnectionResultV1::OtherHandled);
    }
    let (status, body) = local_dev_http_handle_request_with_dispatcher_v1(
        if config.role() == LocalServiceRoleV1::Router {
            let LocalWorkerRoleConfigV1::Router(router_config) = config else {
                unreachable!("Router role config must use Router branch")
            };
            LocalDevHttpTopologyV1::Router(router_config)
        } else {
            LocalDevHttpTopologyV1::FourWorker(config)
        },
        &request,
        router_dispatcher,
    )?;
    write_local_dev_http_response_v1(&mut stream, status, &body)?;
    Ok(LocalWorkerConnectionResultV1::OtherHandled)
}

/// The SQLite files this role owns and the schema each must carry.
fn role_sqlite_schemas(
    config: &LocalWorkerRoleConfigV1,
) -> Vec<(PathBuf, &'static [LocalSqliteMigrationV1])> {
    match config {
        LocalWorkerRoleConfigV1::Router(router) => vec![(
            router.tenant_root.creation_storage_path.clone(),
            LOCAL_ROUTER_CREATION_STATE_MIGRATIONS_V1,
        )],
        LocalWorkerRoleConfigV1::DeriverA(deriver) => vec![
            (
                Path::new(&deriver.role_private_storage_path).to_path_buf(),
                LOCAL_DERIVER_A_ROLE_PRIVATE_MIGRATIONS_V1,
            ),
            (
                deriver.tenant_root.managed_backup_path.clone(),
                LOCAL_MANAGED_BACKUP_MIGRATIONS_V1,
            ),
        ],
        LocalWorkerRoleConfigV1::DeriverB(deriver) => vec![
            (
                Path::new(&deriver.role_private_storage_path).to_path_buf(),
                LOCAL_DERIVER_B_ROLE_PRIVATE_MIGRATIONS_V1,
            ),
            (
                deriver.tenant_root.managed_backup_path.clone(),
                LOCAL_MANAGED_BACKUP_MIGRATIONS_V1,
            ),
        ],
        LocalWorkerRoleConfigV1::SigningWorker(_) => Vec::new(),
    }
}

fn log_worker_request_error(config: &LocalWorkerRoleConfigV1, error: &dyn std::error::Error) {
    let summary = WorkerRequestErrorSummary {
        role: config.role(),
        role_label: config.role().as_str().to_owned(),
        event: "request_error",
        error: error.to_string(),
    };
    match serde_json::to_string(&summary) {
        Ok(json) => eprintln!("{json}"),
        Err(_) => eprintln!("local worker request error: {}", error),
    }
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<WorkerOptions, String> {
    let mut role = None;
    let mut env_path = None;
    let mut migrate = false;
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--role" => {
                let Some(value) = iter.next() else {
                    return Err("--role requires a value".to_owned());
                };
                let parsed =
                    parse_local_service_role_label_v1(&value).map_err(|e| e.to_string())?;
                role = Some(parsed);
            }
            "--env" => {
                let Some(value) = iter.next() else {
                    return Err("--env requires a path".to_owned());
                };
                env_path = Some(PathBuf::from(value));
            }
            "--migrate" => migrate = true,
            "--help" | "-h" => return Err(usage()),
            _ => return Err(format!("unknown argument {arg}\n{}", usage())),
        }
    }
    let Some(role) = role else {
        return Err(format!("missing --role\n{}", usage()));
    };
    let Some(env_path) = env_path else {
        return Err(format!("missing --env\n{}", usage()));
    };
    Ok(WorkerOptions {
        role,
        env_path,
        migrate,
    })
}

fn usage() -> String {
    "usage: router_ab_local_worker --role <router|deriver-a|deriver-b|signing-worker> --env <path> [--migrate]"
        .to_owned()
}
