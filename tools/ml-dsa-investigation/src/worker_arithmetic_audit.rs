//! Inspect private arithmetic in the exact Wasm files packaged by worker-build.

use crate::{InvestigationResult, command_text, digest, require};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, path::Path, process::Command};
use wasmparser::{FuncType, FunctionBody, KnownCustom, Name, Operator, Parser, Payload, TypeRef};

const PRIVATE_FUNCTIONS: [&str; 3] = ["inverse_ntt", "matrix_product_plus_error", "ntt"];

pub(super) fn build_and_inspect(repository: &Path) -> InvestigationResult<Value> {
    let directory = repository.join("crates/ed25519-yao-cloudflare-bench");
    let builder = command_text(Command::new("worker-build").arg("--version"))?;
    let mut roles = Vec::new();
    for role in ["a", "b"] {
        println!("Build and inspect final ML-DSA Worker {role} arithmetic.");
        let output = format!("build/ml-dsa-{role}");
        let feature = format!("ml-dsa-{role}");
        let build = Command::new("worker-build")
            .current_dir(&directory)
            .args(["--release", "--out-dir", &output, "--features", &feature])
            .output()?;
        require(
            build.status.success(),
            &format!(
                "Worker {role} build failed:\n{}\n{}",
                String::from_utf8_lossy(&build.stdout),
                String::from_utf8_lossy(&build.stderr)
            ),
        )?;
        let wasm_path = directory.join(&output).join("index_bg.wasm");
        let script_path = directory.join(&output).join("index.js");
        let bytes = fs::read(&wasm_path)?;
        roles.push(json!({
            "role": role,
            "build_argv": ["worker-build", "--release", "--out-dir", output, "--features", feature],
            "wasm_path": wasm_path.strip_prefix(repository)?,
            "wasm_bytes": bytes.len(),
            "wasm_sha256": digest(&bytes),
            "script_sha256": digest(&fs::read(script_path)?),
            "private_functions": inspect(&bytes)?,
        }));
    }
    Ok(json!({
        "worker_build_version": builder,
        "audit_source_sha256": digest(&fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/worker_arithmetic_audit.rs"))?),
        "worker_manifest_sha256": digest(&fs::read(directory.join("Cargo.toml"))?),
        "worker_lockfile_sha256": digest(&fs::read(directory.join("Cargo.lock"))?),
        "roles": roles,
        "scope": "Final packaged Wasm function bodies, including inlined instructions. Complete instruction streams, local declarations, calls, and conditional control flow are recorded for manual data-flow review.",
    }))
}

fn inspect(bytes: &[u8]) -> InvestigationResult<Vec<Value>> {
    let mut types = Vec::new();
    let mut function_types = Vec::new();
    let mut names = BTreeMap::new();
    let mut bodies = BTreeMap::new();
    let mut function_index = 0;
    for payload in Parser::new(0).parse_all(bytes) {
        match payload? {
            Payload::TypeSection(section) => {
                for kind in section.into_iter_err_on_gc_types() {
                    types.push(kind?);
                }
            }
            Payload::FunctionSection(section) => {
                for kind in section {
                    function_types.push(kind?);
                }
            }
            Payload::ImportSection(imports) => {
                for import in imports {
                    if let TypeRef::Func(kind) = import?.ty {
                        function_types.push(kind);
                        function_index += 1;
                    }
                }
            }
            Payload::CodeSectionEntry(body) => {
                bodies.insert(function_index, body);
                function_index += 1;
            }
            Payload::CustomSection(section) => {
                if let KnownCustom::Name(reader) = section.as_known() {
                    for subsection in reader {
                        if let Name::Function(functions) = subsection? {
                            for function in functions {
                                let function = function?;
                                require(
                                    names.insert(function.index, function.name).is_none(),
                                    "Duplicate Wasm function name entry.",
                                )?;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let mut functions = Vec::new();
    for name in PRIVATE_FUNCTIONS {
        let suffix = format!("::passive::ml_dsa_signing::arithmetic::{name}");
        let matches: Vec<_> = names
            .iter()
            .filter(|(_, symbol)| symbol.starts_with("ed25519_yao[") && symbol.ends_with(&suffix))
            .collect();
        require(
            matches.len() == 1,
            &format!("Expected exactly one final Worker function for {name}."),
        )?;
        let (index, symbol) = matches[0];
        let body = bodies
            .get(index)
            .ok_or("Private arithmetic symbol has no Wasm body.")?;
        let signature = &types[function_types[*index as usize] as usize];
        functions.push(inspect_body(
            bytes, body, *index, name, symbol, &names, signature,
        )?);
    }
    Ok(functions)
}

fn inspect_body(
    bytes: &[u8],
    body: &FunctionBody<'_>,
    index: u32,
    name: &str,
    symbol: &str,
    names: &BTreeMap<u32, &str>,
    signature: &FuncType,
) -> InvestigationResult<Value> {
    let range = body.range();
    let mut operators = body.get_operators_reader()?;
    let mut divisions = Vec::new();
    let mut branches = Vec::new();
    let mut selections = Vec::new();
    let mut calls = Vec::new();
    let mut instructions = Vec::new();
    let locals = body
        .get_locals_reader()?
        .into_iter()
        .map(|entry| {
            entry.map(|(count, kind)| json!({"count": count, "type": format!("{kind:?}")}))
        })
        .collect::<Result<Vec<_>, _>>()?;
    while !operators.eof() {
        let offset = operators.original_position();
        let operator = operators.read()?;
        let site = json!({"wasm_offset": offset, "operator": format!("{operator:?}")});
        instructions.push(site.clone());
        match operator {
            Operator::I32DivS
            | Operator::I32DivU
            | Operator::I64DivS
            | Operator::I64DivU
            | Operator::I32RemS
            | Operator::I32RemU
            | Operator::I64RemS
            | Operator::I64RemU => {
                divisions.push(site);
            }
            Operator::If { .. } | Operator::BrIf { .. } | Operator::BrTable { .. } => {
                branches.push(site);
            }
            Operator::Select | Operator::TypedSelect { .. } => {
                selections.push(site);
            }
            Operator::Call { function_index } | Operator::ReturnCall { function_index } => {
                calls.push(json!({
                    "wasm_offset": offset,
                    "function_index": function_index,
                    "symbol": names.get(&function_index),
                }));
            }
            Operator::CallIndirect { .. }
            | Operator::ReturnCallIndirect { .. }
            | Operator::CallRef { .. }
            | Operator::ReturnCallRef { .. } => {
                return Err(
                    format!("Unresolved indirect call in private arithmetic {name}.").into(),
                );
            }
            _ => {}
        }
    }
    require(
        divisions.is_empty(),
        &format!("Division or remainder remains in final Worker {name}: {divisions:?}"),
    )?;
    Ok(json!({
        "function": name,
        "symbol": symbol,
        "function_index": index,
        "body_range": {"start": range.start, "end": range.end},
        "body_sha256": digest(&bytes[range]),
        "operator_count": instructions.len(),
        "parameter_types": signature.params().iter().map(|kind| format!("{kind:?}")).collect::<Vec<_>>(),
        "result_types": signature.results().iter().map(|kind| format!("{kind:?}")).collect::<Vec<_>>(),
        "locals": locals,
        "instructions": instructions,
        "division_or_remainder_sites": divisions,
        "conditional_branch_sites_requiring_review": branches,
        "direct_calls_requiring_review": calls,
        "value_selection_sites_requiring_target_review": selections,
    }))
}
