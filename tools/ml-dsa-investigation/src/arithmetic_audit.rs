//! Repeatable compiled-code evidence for the private polynomial arithmetic.

use crate::{InvestigationResult, command_text, digest, require};
use serde_json::{Value, json};
use std::{env, fs, path::Path, process::Command};

const PRIVATE_FUNCTIONS: [&str; 3] = ["inverse_ntt", "matrix_product_plus_error", "ntt"];

pub(super) fn run(output: &Path) -> InvestigationResult<()> {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or("Missing repository path.")?;
    let directory = tempfile::tempdir()?;
    let compiler = command_text(Command::new("rustc").args(["--version", "--verbose"]))?;
    let host = compiler
        .lines()
        .find_map(parse_host)
        .ok_or("Missing rustc host target.")?;
    require(
        host.starts_with("aarch64-"),
        "The native instruction classifier currently requires an AArch64 host.",
    )?;
    let mut targets = Vec::new();
    for target in ["wasm32-unknown-unknown", host] {
        let assembly_path = directory.path().join(format!("{target}.s"));
        let compile = Command::new("cargo")
            .current_dir(repository)
            .args([
                "rustc",
                "--locked",
                "--release",
                "--manifest-path",
                "crates/ed25519-yao/Cargo.toml",
                "--lib",
                "--features",
                "ml-dsa-runtime-benchmark",
                "--target",
                target,
                "--",
            ])
            .arg(format!("--emit=asm={}", assembly_path.display()))
            .output()?;
        require(
            compile.status.success(),
            &String::from_utf8_lossy(&compile.stderr),
        )?;
        let assembly = fs::read_to_string(&assembly_path)?;
        targets.push(inspect(&assembly, target)?);
    }
    let report = json!({
        "schema": "seams.ml-dsa-arithmetic-audit.v1",
        "source_revision": command_text(Command::new("git").args(["rev-parse", "HEAD"]).current_dir(repository))?,
        "arithmetic_source_sha256": digest(&fs::read(repository.join("crates/ed25519-yao/src/passive/ml_dsa_signing/arithmetic.rs"))?),
        "audit_source_sha256": digest(&fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/arithmetic_audit.rs"))?),
        "compiler": compiler,
        "profile": "release",
        "targets": targets,
        "result": "no-division-in-private-arithmetic; target-qualification-open",
        "limits": [
            "The check covers the compiled core's three private polynomial arithmetic functions and their inlined reductions.",
            "Conditional branches require manual data-flow review. Their count alone proves no timing property.",
            "Public matrix expansion and public-length hashing can retain division or remainder instructions.",
            "This is pre-link core assembly. Final Worker optimization, Cloudflare JIT behavior, other cryptographic primitives, and hardware timing remain outside this check."
        ],
        "reproduce_argv": ["cargo", "run", "--release", "--locked", "--manifest-path", "tools/ml-dsa-investigation/Cargo.toml", "--", "inspect-arithmetic", output.display().to_string()]
    });
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, serde_json::to_vec_pretty(&report)?)?;
    println!("Wrote compiled arithmetic evidence to {}", output.display());
    Ok(())
}

fn parse_host(line: &str) -> Option<&str> {
    line.strip_prefix("host: ")
}

fn inspect(assembly: &str, target: &str) -> InvestigationResult<Value> {
    let mut functions = Vec::new();
    for name in PRIVATE_FUNCTIONS {
        let suffix = format!("10arithmetic{}{name}", name.len());
        let mut lines = assembly.lines();
        let symbol = lines
            .find_map(|line| function_symbol(line, &suffix))
            .ok_or_else(|| format!("Missing compiled private arithmetic function: {name}"))?;
        let mut body = Vec::new();
        for line in lines {
            if is_function_label(line) {
                break;
            }
            body.push(line);
        }
        let mut divisions = Vec::new();
        let mut branches = Vec::new();
        for line in &body {
            let instruction = line.trim();
            let opcode = instruction.split_whitespace().next().unwrap_or("");
            if matches!(
                opcode,
                "udiv"
                    | "sdiv"
                    | "i32.div_u"
                    | "i32.div_s"
                    | "i64.div_u"
                    | "i64.div_s"
                    | "i32.rem_u"
                    | "i32.rem_s"
                    | "i64.rem_u"
                    | "i64.rem_s"
            ) {
                divisions.push(instruction);
            }
            if opcode.starts_with("b.")
                || matches!(opcode, "cbz" | "cbnz" | "tbz" | "tbnz" | "br_if" | "if")
            {
                branches.push(instruction);
            }
        }
        require(
            divisions.is_empty(),
            &format!("Division remains in {target} {name}: {divisions:?}"),
        )?;
        functions.push(json!({
            "function": name,
            "symbol": symbol,
            "body_sha256": digest(body.join("\n").as_bytes()),
            "division_or_remainder_sites": divisions,
            "conditional_branch_sites_requiring_review": branches,
        }));
    }
    Ok(json!({
        "target": target,
        "assembly_sha256": digest(assembly.as_bytes()),
        "private_functions": functions,
    }))
}

fn function_symbol<'a>(line: &'a str, suffix: &str) -> Option<&'a str> {
    if is_function_label(line) {
        let symbol = line.split(':').next()?;
        if symbol.ends_with(suffix) {
            return Some(symbol);
        }
    }
    None
}

fn is_function_label(line: &str) -> bool {
    line.starts_with('_') && line.contains(':')
}
