#[path = "local_dev_process/mod.rs"]
mod local_dev_process;

use local_dev_process::{
    normalize_root, post_json_to_path, wait_for_existing_health, LocalWorkerSpawnReceipt,
    LocalWorkerUrls,
};
use router_ab_core::{LocalServiceRoleV1, Role};
use router_ab_dev::{
    run_example_local_router_ab_dev_http_ceremony_v1, LocalDeriverPeerMessageReceiptV1,
    LOCAL_DERIVER_A_PEER_PATH, LOCAL_DERIVER_B_PEER_PATH,
};
use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::Instant,
};

#[derive(Debug, Clone, PartialEq, Eq)]
struct SmokeOptions {
    root: PathBuf,
    report_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct SmokeSummary {
    root: String,
    mode: String,
    topology: &'static str,
    urls: LocalWorkerUrls,
    spawned_processes: Vec<LocalWorkerSpawnReceipt>,
    setup_status: String,
    deriver_b_peer_status: String,
    deriver_a_peer_status: String,
    setup_elapsed_ms: u64,
    deriver_b_peer_elapsed_ms: u64,
    deriver_a_peer_elapsed_ms: u64,
    total_elapsed_ms: u64,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let options = match parse_args(env::args().skip(1)) {
        Ok(options) => options,
        Err(message) if message == usage() => {
            println!("{message}");
            return Ok(());
        }
        Err(message) => return Err(message.into()),
    };
    let root = normalize_root(options.root)?;
    let urls = existing_urls(&root)?;
    wait_for_topology_health(&urls)?;
    let summary = run_smoke(&root, "existing", urls, Vec::new())?;
    emit_summary(&summary, options.report_path.as_deref())?;
    Ok(())
}

fn existing_urls(root: &Path) -> Result<LocalWorkerUrls, Box<dyn std::error::Error>> {
    Ok(LocalWorkerUrls::from_env(root)?)
}

fn wait_for_topology_health(urls: &LocalWorkerUrls) -> Result<(), Box<dyn std::error::Error>> {
    for url in [
        &urls.router,
        &urls.deriver_a,
        &urls.deriver_b,
        &urls.signing_worker,
    ] {
        wait_for_existing_health(url)?;
    }
    Ok(())
}

fn run_smoke(
    root: &std::path::Path,
    mode: &str,
    urls: LocalWorkerUrls,
    spawned_processes: Vec<LocalWorkerSpawnReceipt>,
) -> Result<SmokeSummary, Box<dyn std::error::Error>> {
    let total_start = Instant::now();
    let setup_start = Instant::now();
    let ceremony = run_example_local_router_ab_dev_http_ceremony_v1()?;
    ceremony
        .core_http_ceremony
        .router_response
        .validate()
        .map_err(|error| format!("Router setup smoke response failed validation: {error}"))?;
    let setup_elapsed_ms = elapsed_ms(setup_start);

    let deriver_b_start = Instant::now();
    let (deriver_b_status, deriver_b_body) = post_json_to_path(
        &urls.deriver_b,
        LOCAL_DERIVER_B_PEER_PATH,
        &ceremony
            .core_http_ceremony
            .deriver_a_peer_request
            .envelope
            .message,
    )?;
    if deriver_b_status != 200 {
        return Err(format!(
            "Deriver B peer smoke returned HTTP {deriver_b_status}: {deriver_b_body}"
        )
        .into());
    }
    let deriver_b_receipt: LocalDeriverPeerMessageReceiptV1 =
        serde_json::from_str(&deriver_b_body)?;
    if deriver_b_receipt.receiver_role != LocalServiceRoleV1::DeriverB
        || deriver_b_receipt.accepted_from_role != Role::SignerA
        || deriver_b_receipt.status != "accepted"
    {
        return Err("Deriver B peer smoke receipt had the wrong role binding".into());
    }
    let deriver_b_peer_elapsed_ms = elapsed_ms(deriver_b_start);

    let deriver_a_start = Instant::now();
    let (deriver_a_status, deriver_a_body) = post_json_to_path(
        &urls.deriver_a,
        LOCAL_DERIVER_A_PEER_PATH,
        &ceremony
            .core_http_ceremony
            .deriver_b_peer_request
            .envelope
            .message,
    )?;
    if deriver_a_status != 200 {
        return Err(format!(
            "Deriver A peer smoke returned HTTP {deriver_a_status}: {deriver_a_body}"
        )
        .into());
    }
    let deriver_a_receipt: LocalDeriverPeerMessageReceiptV1 =
        serde_json::from_str(&deriver_a_body)?;
    if deriver_a_receipt.receiver_role != LocalServiceRoleV1::DeriverA
        || deriver_a_receipt.accepted_from_role != Role::SignerB
        || deriver_a_receipt.status != "accepted"
    {
        return Err("Deriver A peer smoke receipt had the wrong role binding".into());
    }
    let deriver_a_peer_elapsed_ms = elapsed_ms(deriver_a_start);

    Ok(SmokeSummary {
        root: root.display().to_string(),
        mode: mode.to_owned(),
        topology: "local_role_processes",
        urls,
        spawned_processes,
        setup_status: "accepted".to_owned(),
        deriver_b_peer_status: deriver_b_receipt.status,
        deriver_a_peer_status: deriver_a_receipt.status,
        setup_elapsed_ms,
        deriver_b_peer_elapsed_ms,
        deriver_a_peer_elapsed_ms,
        total_elapsed_ms: elapsed_ms(total_start),
    })
}

fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}

fn emit_summary(
    summary: &impl Serialize,
    report_path: Option<&Path>,
) -> Result<(), Box<dyn std::error::Error>> {
    let json = serde_json::to_string_pretty(summary)?;
    if let Some(path) = report_path {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, format!("{json}\n"))?;
    }
    println!("{json}");
    Ok(())
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<SmokeOptions, String> {
    let mut root = PathBuf::from(".");
    let mut report_path = None;
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
            "--out" => {
                let Some(value) = iter.next() else {
                    return Err("--out requires a path".to_owned());
                };
                report_path = Some(PathBuf::from(value));
            }
            "--help" | "-h" => {
                return Err(usage());
            }
            _ => {
                return Err(format!("unknown argument {arg}\n{}", usage()));
            }
        }
    }
    Ok(SmokeOptions { root, report_path })
}

fn usage() -> String {
    "usage: router_ab_local_smoke [--root <path>] [--out <path>]".to_owned()
}
