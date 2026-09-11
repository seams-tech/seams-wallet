#![forbid(unsafe_code)]
//! The `seams` binary.

use seams_cli::{
    parse_invocation_v1, run_command_v1, HttpsConsoleTransportV1, SeamsExitCodeV1, SeamsResultV1,
};
use seams_recovery_core::RecoveryHostSecretCapabilitiesV1;
use std::io::IsTerminal;

fn main() {
    let transport = match HttpsConsoleTransportV1::from_environment() {
        Ok(transport) => transport,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let exit = match parse_invocation_v1(&args) {
        Ok(invocation) => {
            let (result, exit) =
                run_command_v1(&invocation.command, host_capabilities(), &transport);
            emit(&result, invocation.json);
            exit
        }
        Err(error) => {
            let exit = SeamsExitCodeV1::UsageOrInvalidInput;
            emit(
                &SeamsResultV1::Failed {
                    category: exit.category().to_owned(),
                    retryable: exit.retryable(),
                    message: error.message().to_owned(),
                },
                args.iter().any(|argument| argument == "--json"),
            );
            exit
        }
    };
    std::process::exit(exit.code());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn host_capabilities() -> RecoveryHostSecretCapabilitiesV1 {
    use nix::sys::mman::{mlockall, MlockAllFlags};
    #[cfg(target_os = "linux")]
    use nix::sys::resource::{getrlimit, RLIM_INFINITY};
    use nix::sys::resource::{setrlimit, Resource};

    let core_limit_disabled = setrlimit(Resource::RLIMIT_CORE, 0, 0).is_ok();
    #[cfg(target_os = "linux")]
    let crash_dumps_suppressed =
        nix::sys::prctl::set_dumpable(false).is_ok() && core_limit_disabled;
    #[cfg(target_os = "macos")]
    let crash_dumps_suppressed = core_limit_disabled;

    // MCL_FUTURE with a finite limit can make a later allocation fail.
    // Attempt to remove that limit before enabling process-wide locking.
    #[cfg(target_os = "linux")]
    let unlimited_lock_budget =
        matches!(getrlimit(Resource::RLIMIT_MEMLOCK), Ok((RLIM_INFINITY, _)))
            || setrlimit(Resource::RLIMIT_MEMLOCK, RLIM_INFINITY, RLIM_INFINITY).is_ok();
    #[cfg(target_os = "macos")]
    let unlimited_lock_budget = true;
    let memory_locked = unlimited_lock_budget
        && mlockall(MlockAllFlags::MCL_CURRENT | MlockAllFlags::MCL_FUTURE).is_ok();
    RecoveryHostSecretCapabilitiesV1::new(memory_locked, crash_dumps_suppressed)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn host_capabilities() -> RecoveryHostSecretCapabilitiesV1 {
    RecoveryHostSecretCapabilitiesV1::new(false, false)
}

fn emit(result: &SeamsResultV1, json: bool) {
    if json {
        match serde_json::to_string(result) {
            Ok(encoded) => println!("{encoded}"),
            Err(error) => eprintln!("error: could not encode the result: {error}"),
        }
        return;
    }
    match result {
        SeamsResultV1::Failed { message, .. } if use_color(std::io::stderr().is_terminal()) => {
            eprintln!("\x1b[1;31merror:\x1b[0m {message}");
        }
        SeamsResultV1::Failed { .. } => eprintln!("{}", result.render_text()),
        SeamsResultV1::Usage { text } if use_color(std::io::stdout().is_terminal()) => {
            println!("{}", color_help(text));
        }
        _ => println!(
            "{}",
            result.render_terminal_text(use_color(std::io::stdout().is_terminal()))
        ),
    }
}

fn use_color(is_terminal: bool) -> bool {
    is_terminal
        && std::env::var_os("NO_COLOR").is_none_or(|value| value.is_empty())
        && std::env::var_os("TERM").is_none_or(|value| value != "dumb")
}

fn color_help(text: &str) -> String {
    let mut output = String::new();
    for (index, line) in text.lines().enumerate() {
        if index == 0
            || matches!(
                line,
                "Usage"
                    | "Everyday tasks"
                    | "Quick start"
                    | "Help"
                    | "Example"
                    | "Release verification"
            )
        {
            output.push_str(&format!("\x1b[1;36m{line}\x1b[0m\n"));
        } else if line.starts_with("  seams-wallet ") {
            output.push_str(&format!("\x1b[1m{line}\x1b[0m\n"));
        } else if line.starts_with("    --")
            || line.starts_with("    [--")
            || line.starts_with("  --")
        {
            for token in line.split_inclusive(char::is_whitespace) {
                if token.trim_start_matches('[').starts_with("--") {
                    output.push_str(&format!("\x1b[36m{token}\x1b[0m"));
                } else {
                    output.push_str(token);
                }
            }
            output.push('\n');
        } else {
            output.push_str(line);
            output.push('\n');
        }
    }
    output.pop();
    output
}
