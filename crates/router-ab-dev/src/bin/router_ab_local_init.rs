#[path = "local_initializer/mod.rs"]
mod local_initializer;

use local_initializer::{free_loopback_origin, LocalWorkerUrls};
use router_ab_dev::{local_env_materialization_plan_at_v1, LocalStackOriginsV1};
use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, PartialEq, Eq)]
struct InitOptions {
    root: PathBuf,
    force: bool,
    ephemeral_ports: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct InitSummary {
    root: String,
    files: Vec<String>,
    urls: Option<LocalWorkerUrls>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let options = parse_args(env::args().skip(1))?;
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed)?;
    let origins = if options.ephemeral_ports {
        Some(LocalStackOriginsV1 {
            router: free_loopback_origin()?,
            deriver_a: free_loopback_origin()?,
            deriver_b: free_loopback_origin()?,
            signing_worker: free_loopback_origin()?,
            control_plane: free_loopback_origin()?,
        })
    } else {
        None
    };
    let plan = local_env_materialization_plan_at_v1(&seed, &origins.unwrap_or_default())?;

    let paths: Vec<(&str, &str)> = plan
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.contents.as_str()))
        .chain(
            plan.tenant_root_files
                .iter()
                .map(|file| (file.path.as_str(), file.contents.as_str())),
        )
        .collect();
    for (relative, contents) in paths {
        let path = options.root.join(relative);
        if path.exists() && !options.force {
            return Err(format!(
                "{} already exists; pass --force to regenerate local env files",
                path.display()
            )
            .into());
        }
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        fs::write(path, contents)?;
    }
    let summary = InitSummary {
        root: options.root.display().to_string(),
        files: plan
            .files
            .into_iter()
            .map(|file| file.path)
            .chain(plan.tenant_root_files.into_iter().map(|file| file.path))
            .collect(),
        urls: origins.map(|origins| LocalWorkerUrls {
            router: origins.router.to_string(),
            deriver_a: origins.deriver_a.to_string(),
            deriver_b: origins.deriver_b.to_string(),
            signing_worker: origins.signing_worker.to_string(),
            control_plane: origins.control_plane.to_string(),
        }),
    };
    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<InitOptions, String> {
    let mut root = PathBuf::from(".");
    let mut force = false;
    let mut ephemeral_ports = false;
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--" => {}
            "--root" => {
                let Some(value) = iter.next() else {
                    return Err("--root requires a path".to_owned());
                };
                root = PathBuf::from(value);
            }
            "--force" => {
                force = true;
            }
            "--ephemeral-ports" => {
                ephemeral_ports = true;
            }
            "--help" | "-h" => {
                return Err(usage());
            }
            _ => {
                return Err(format!("unknown argument {arg}\n{}", usage()));
            }
        }
    }
    require_relative_or_absolute_path(&root)?;
    Ok(InitOptions {
        root,
        force,
        ephemeral_ports,
    })
}

fn require_relative_or_absolute_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("--root must not be empty".to_owned());
    }
    Ok(())
}

fn usage() -> String {
    "usage: router_ab_local_init [--root <path>] [--force] [--ephemeral-ports]".to_owned()
}
