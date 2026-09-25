//! The VM tenant-root control plane.
//!
//! The only VM process that holds the issuer signing Secret. It serves
//! genesis, role-creation commands and initial activation over the role-shared
//! credential and keeps no state of its own: the Router owns the creation
//! state. Startup fails closed on a forbidden key or an issuer Secret that does
//! not derive the published active key.

use router_ab_dev::{
    local_tenant_root_control_plane_route_v1, parse_local_env_file_contents_v1,
    parse_local_tenant_root_control_plane_config_v1, read_local_dev_http_request_v1,
    write_local_dev_http_response_v1,
};
use std::{env, fs, net::TcpListener, path::PathBuf, sync::Arc, thread};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let env_path = parse_args(env::args().skip(1))?;
    let contents = fs::read_to_string(&env_path)?;
    let config = Arc::new(parse_local_tenant_root_control_plane_config_v1(
        parse_local_env_file_contents_v1(&contents)?,
    )?);
    let bind_addr = config
        .bind_url
        .strip_prefix("http://")
        .ok_or("LOCAL_TENANT_ROOT_CONTROL_PLANE_URL must be an http:// origin")?
        .trim_end_matches('/')
        .to_owned();
    let listener = TcpListener::bind(&bind_addr)?;
    eprintln!(
        "{}",
        serde_json::json!({
            "role": "tenant_root_control_plane",
            "bind_addr": bind_addr,
            "env_path": env_path.display().to_string(),
        })
    );
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let config = Arc::clone(&config);
        thread::spawn(move || {
            let result = read_local_dev_http_request_v1(&mut stream).and_then(|request| {
                let (status, body) = local_tenant_root_control_plane_route_v1(&config, &request);
                write_local_dev_http_response_v1(&mut stream, status, &body)
            });
            if let Err(error) = result {
                eprintln!(
                    "{}",
                    serde_json::json!({
                        "role": "tenant_root_control_plane",
                        "event": "request_error",
                        "error": error.to_string(),
                    })
                );
            }
        });
    }
    Ok(())
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<PathBuf, String> {
    let mut iter = args.into_iter();
    match (iter.next().as_deref(), iter.next(), iter.next()) {
        (Some("--env"), Some(path), None) => Ok(PathBuf::from(path)),
        _ => Err("usage: router_ab_local_tenant_root_control_plane --env <path>".to_owned()),
    }
}
